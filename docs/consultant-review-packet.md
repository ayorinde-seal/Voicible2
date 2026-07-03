# Voicible — ASL Consultant Review Packet

**Purpose:** this system pulls its motion from real motion-capture recordings (the SLMocapArchive by Studio Galt), but the archive's own creator is a hearing person and says plainly in his README that his ASL knowledge "is not complete" and mistakes will happen. Nothing in this codebase can substitute for review by a Deaf person or certified ASL professional — this document exists to make that review as fast and concrete as possible, not to replace it.

If you are a hearing developer reading this instead of a consultant: this packet is the thing to hand to your Deaf/ASL reviewer, not a checklist you fill out yourself.

---

## What we need reviewed

1. **The church-domain vocabulary mapping** (`data/vocabulary/church.json`) — does each mapped sign actually convey the intended church term, or would a fluent signer choose differently / fingerspell it instead?
2. **Overall gloss grammar** produced by the LLM (topic-comment structure, dropped articles, etc.) — does a sample of real sermon sentences read naturally in ASL word order once converted?
3. **Any words your congregation/venue uses often** that aren't in the mapping yet and should be added or fingerspelled deliberately rather than left to chance.

---

## 1. Vocabulary mapping to review

Each row is: church term → the archive sign we're currently substituting. To actually watch a sign, its recording lives at:
`data/mocap-archive/SG ASL Dictionary/<bucket>/SG ASL <Sign> <date> Upload/Documentation/SG ASL <Sign> <date>.mkv` (or the captioned `... CC.mp4` alongside it) — these aren't included in the small starter slice shipped with this repo, so you may need to pull the specific Upload folder first (see README "Getting the rest of the archive data").

| Church term | Currently mapped to | Reviewer verdict (✅ / ❌ / suggest alt.) | Notes |
|---|---|---|---|
| SANCTIFICATION | HOLY | | |
| CONGREGATION | CHURCH | | |
| SERMON | PREACH | | |
| BAPTISM | BAPTIZE | | |
| SCRIPTURE | BIBLE | | |
| COMMUNION | REMEMBER | | |
| TITHE | GIVE-MONEY | | |
| FELLOWSHIP | TOGETHER | | |
| PASTOR | PREACHER | | |
| WORSHIP | PRAISE | | |
| GOSPEL | GOOD-NEWS | | |
| REDEMPTION | SAVE | | |
| GRACE | KIND | | |
| REPENTANCE / REPENT | SORRY | | |
| COVENANT | PROMISE | | |
| DISCIPLE | FOLLOW | | |
| PROPHECY / PROPHET | FUTURE-TELL | | |
| HALLELUJAH | PRAISE | | |
| BLESSING | BLESS | | |
| OFFERING | GIVE | | |
| TESTIMONY | TESTIFY | | |
| RESURRECTION | RISE-AGAIN | | |
| SALVATION | SAVE | | |
| TRINITY | THREE-IN-ONE | | |
| APOSTLE | SEND | | |
| PARABLE | STORY | | |

These were chosen as reasonable starting guesses based on the English meaning, by a hearing developer, with no ASL training — treat every row as a draft, not a decision.

---

## 2. Known gaps (confirmed, not guessed)

- **THANK-YOU / THANKS / GRATITUDE has no dictionary sign in the archive at all as of this writing.** It will fall back to fingerspelling (T-H-A-N-K-Y-O-U). Please advise: is a fingerspelled "thank you" acceptable in a sermon-interpretation context, or should we record/source a proper sign for it before going live? This is an extremely common word, so it's a high-priority gap.
- The archive is actively growing and inconsistently covers common words — expect other gaps not yet discovered. The app's live "vocabulary coverage %" indicator will surface these as real usage happens; a recurring low-coverage word is worth flagging back to us even outside a formal review session.

---

## 3. How to review an individual sign

For any sign in question:

1. Find its Upload folder under `data/mocap-archive/SG ASL Dictionary/` (bucketed by first letter, e.g. `ASL C/` for "Church").
2. Watch `Documentation/... .mkv` (raw) or `... CC.mp4` (captioned) — no software beyond a video player needed.
3. Check `Documentation/... ReadMe.txt` for the submitted/audited-by stamp and date, in case multiple versions exist (the system always uses the newest date automatically).
4. Note whether the handshape, movement, AND facial expression together convey the intended meaning — ASL grammar lives partly in the face, so a technically-correct handshape with the wrong (or no) facial expression can still be wrong or ambiguous.

---

## 4. Sending feedback back

Once reviewed, changes go into two places:

- **Wrong/better vocabulary mapping** → edit `data/vocabulary/church.json` directly (it's a plain JSON file, `"CHURCH_TERM": "SIGN_TO_USE"`).
- **A sign that needs to be re-recorded** → follow "Adding custom signs for words the archive doesn't cover" in the main `README.md`; the new recording slots in automatically as long as it's dated and named like the archive's existing files.

No code changes are needed for either of these — both are data-only edits.
