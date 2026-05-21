// Vercel serverless function - grades a student's quiz submission.
//
// THIS IS THE SECURITY BOUNDARY for the quiz feature. The client never has
// access to is_correct flags on answers (the public_course_quizzes view
// strips them). The only way a student can find out whether an answer is
// correct is to submit and receive a graded result from this endpoint.
//
// Security model:
//   1. Caller must be authenticated (Bearer token).
//   2. Caller must be enrolled in the course this quiz belongs to.
//   3. Raw course_quizzes table is queried via service_role to get the
//      correct answers (RLS would block authenticated reads otherwise).
//   4. Response shape depends on the quiz's require_pass setting:
//        - require_pass=true:  response is {passed: bool} only. No detail
//          about which questions were right/wrong. Otherwise a student
//          could iteratively probe ("Q3 wrong"), fix Q3, resubmit, fix
//          Q5, etc. - a slow but successful brute force.
//        - require_pass=false: response includes full results - which
//          questions were wrong + the correct answer IDs - so the student
//          can learn from their mistakes. No gating, full transparency.
//   5. When require_pass=true AND passed=true, the student's pass record
//      is INSERTed into course_quiz_passes. Idempotent on (enrollment_id,
//      quiz_id) PK. Subsequent passes don't error - we just don't write a
//      duplicate row.
//
// Defensive grading:
//   - Submitted answers are deduped per question (last submission wins).
//   - Submitted question_ids that don't exist in the quiz are ignored.
//   - Submitted answer_ids that don't match any answer in their question
//     count as wrong (not as an error).
//   - Questions the student didn't answer count as wrong.
//
// POST /api/grade-quiz
// Headers: Authorization: Bearer <token>   (required)
// Body:    { quiz_id, answers: [{question_id, answer_id}, ...] }
//
// Response (require_pass=true):
//   { passed: boolean, total_questions: number, correct_count: number }
//
// Response (require_pass=false):
//   { passed: boolean, total_questions: number, correct_count: number,
//     results: [{question_id, was_correct, correct_answer_id, your_answer_id|null}, ...] }

const SUPABASE_URL = 'https://kjytapcgxukalwsyputk.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_PLU28Un_GfsUXeUsK3zB9Q_hvNM7aeG';

function getServiceKey() {
  var k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured');
  return k;
}

// Verify a JWT and return the user id+email if valid, null otherwise.
async function verifyJWT(authHeader) {
  if (!authHeader || authHeader.indexOf('Bearer ') !== 0) return null;
  var token = authHeader.split(' ')[1];
  try {
    var res = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { 'Authorization': 'Bearer ' + token, 'apikey': SUPABASE_ANON_KEY }
    });
    if (!res.ok) return null;
    var data = await res.json();
    return data && data.id ? { id: data.id, email: data.email } : null;
  } catch (e) {
    return null;
  }
}

// Service-role REST SELECT. Bypasses RLS - use sparingly and only for
// trusted server-side reads.
async function sbSelect(path) {
  var key = getServiceKey();
  var res = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    headers: { apikey: key, Authorization: 'Bearer ' + key }
  });
  if (!res.ok) throw new Error('Supabase select failed: ' + res.status);
  return res.json();
}

// Service-role REST INSERT with on-conflict-do-nothing behavior. Used to
// write pass records without erroring on duplicates.
async function sbInsertIgnoreDup(table, row) {
  var key = getServiceKey();
  var res = await fetch(SUPABASE_URL + '/rest/v1/' + table, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=minimal'
    },
    body: JSON.stringify(row)
  });
  // 201 = inserted; 409 should not occur with resolution=ignore-duplicates
  // but be defensive. Any other status is a real error.
  if (res.status !== 201 && res.status !== 200 && res.status !== 204) {
    var body = await res.text().catch(function() { return ''; });
    throw new Error('Insert failed: ' + res.status + ' ' + body.slice(0, 200));
  }
}

module.exports = async (req, res) => {
  // CORS preflight - matches other endpoints in this codebase
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Parse body. Catch malformed JSON cleanly so we return 400 instead of
  // crashing into a 500 (same robustness pattern as download-lesson-file).
  var body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch (e) {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  var quizId = body.quiz_id;
  var submitted = Array.isArray(body.answers) ? body.answers : [];
  if (!quizId || typeof quizId !== 'string') {
    return res.status(400).json({ error: 'quiz_id required' });
  }

  try {
    // 1. Authenticate
    var user = await verifyJWT(req.headers.authorization || '');
    if (!user) {
      return res.status(401).json({ error: 'Your session has expired. Please log off and back in.' });
    }

    // 2. Load the quiz from raw table (need is_correct flags)
    var quizRows = await sbSelect('course_quizzes?id=eq.' + encodeURIComponent(quizId) + '&select=id,course_id,require_pass,questions');
    if (!Array.isArray(quizRows) || quizRows.length === 0) {
      return res.status(404).json({ error: 'Quiz not found' });
    }
    var quiz = quizRows[0];

    // 3. Verify enrollment - the user must be enrolled in the parent course
    var enrollments = await sbSelect('course_enrollments?course_id=eq.' + encodeURIComponent(quiz.course_id) + '&user_id=eq.' + encodeURIComponent(user.id) + '&select=id');
    if (!Array.isArray(enrollments) || enrollments.length === 0) {
      return res.status(403).json({ error: 'You are not enrolled in this course' });
    }
    var enrollmentId = enrollments[0].id;

    // 4. Build a map of submitted answers, deduped (last submission wins).
    //    Keying by question_id handles duplicates cleanly.
    var submittedByQuestion = {};
    for (var i = 0; i < submitted.length; i++) {
      var s = submitted[i];
      if (s && typeof s.question_id === 'string' && typeof s.answer_id === 'string') {
        submittedByQuestion[s.question_id] = s.answer_id;
      }
    }

    // 5. Grade each question in the quiz. We iterate over the quiz's
    //    questions (the source of truth), not the submitted answers, so
    //    forged question_ids in the submission are silently ignored and
    //    missing answers count as wrong.
    var questions = Array.isArray(quiz.questions) ? quiz.questions : [];
    var totalQuestions = questions.length;
    var correctCount = 0;
    var results = [];

    for (var qi = 0; qi < questions.length; qi++) {
      var q = questions[qi];
      var answers = Array.isArray(q.answers) ? q.answers : [];
      // Find the correct answer for this question
      var correctAnswer = null;
      for (var ai = 0; ai < answers.length; ai++) {
        if (answers[ai] && answers[ai].is_correct === true) {
          correctAnswer = answers[ai];
          break;
        }
      }
      // Skip questions with no correct answer - this would indicate
      // malformed data (creator save validation should have prevented it,
      // but defense in depth). Don't penalize the student.
      if (!correctAnswer) continue;

      var submittedAnswerId = submittedByQuestion[q.id] || null;
      var wasCorrect = submittedAnswerId !== null && submittedAnswerId === correctAnswer.id;
      if (wasCorrect) correctCount++;

      results.push({
        question_id: q.id,
        was_correct: wasCorrect,
        correct_answer_id: correctAnswer.id,
        your_answer_id: submittedAnswerId
      });
    }

    // 6. Pass logic: "pass" means every gradable question was answered
    //    correctly. With no questions in the quiz, we don't grade it as
    //    passed (edge case; the save flow auto-deletes empty quizzes so
    //    this shouldn't happen, but defense in depth).
    var passed = totalQuestions > 0 && correctCount === totalQuestions;

    // 7. Write pass record if applicable. Only when require_pass=true
    //    (no point recording passes for ungated quizzes).
    if (passed && quiz.require_pass === true) {
      try {
        await sbInsertIgnoreDup('course_quiz_passes', {
          enrollment_id: enrollmentId,
          quiz_id: quiz.id
        });
      } catch (e) {
        // Log but don't fail the response - the student passed, the record
        // write failed for some transient reason. They can resubmit. The
        // alternative (returning an error) would block a legitimate pass.
        console.error('[grade-quiz] Pass record write failed:', e && e.message);
      }
    }

    // 8. Build response. Shape depends on require_pass.
    var response = {
      passed: passed,
      total_questions: totalQuestions,
      correct_count: correctCount
    };
    if (quiz.require_pass !== true) {
      // Non-require-pass quizzes get full results so the student can learn.
      response.results = results;
    }
    // require_pass=true responses deliberately exclude the per-question
    // results array. No leaking which questions were wrong.

    return res.status(200).json(response);
  } catch (e) {
    console.error('[grade-quiz] Error:', e && e.message);
    return res.status(500).json({ error: 'Grading failed. Please try again.' });
  }
};
