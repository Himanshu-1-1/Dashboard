# Spec: the Chief of Staff bot writes its Next: clauses to Zoho Tasks

Status: **not implemented**. This describes work in `C:\chief-of-staff` on Hemang's laptop, which the dashboard
repository never changes. Written Nov 20, 2026, after Hemang chose Zoho Tasks as the place a done state lives.

## Why

The bot already ends nearly every `Conversation note:` with a `Next:` clause — of ~435–470 conversation notes in Zoho
today, all but one carry a parseable `Mon D, YYYY:` date prefix and nearly all carry a clause. The dashboard's Chief of
Staff tab lists those clauses as action items and derives a priority from what each one says and how old it is.

What it cannot do is say whether one is finished. A Zoho **note** has no status field and no priority field — the whole
field list is Owner, Note_Title, Note_Content, Parent_Id, Created_By, Modified_By, Created_Time, Modified_Time, id,
Associated_Id__s, Record_Status__s. So nothing anywhere records that the work in a clause got done, and the dashboard's
Zoho client is read-only by hard constraint (`ZohoCRM.coql.READ,ZohoCRM.modules.READ`) and must stay that way.

A Zoho **Task** has both. The bot already writes notes, so it holds a write-scoped client; it is the only component
that can create them, and the only one that knows what the conversation actually committed us to.

## What the bot writes

For each conversation note it files whose `Next:` clause is **ours to move**, create one Zoho Task on the same contact.
A clause that is purely the other side's move ("Waiting on them to review the file") gets no task: the dashboard
already shows it as Watching and promotes it to ours after ten days.

| Field | Value |
| :--- | :--- |
| `Subject` | `CoS: ` followed by the clause, trimmed to Zoho's 255-character limit on a word boundary. The prefix is what makes the dashboard's match exact instead of fuzzy. |
| `Who_Id` | The contact the note is filed against — the same id as the note's `Parent_Id`. |
| `Status` | `Not Started` on create. `Completed` when the work is done (see Closing). |
| `Priority` | `High`, `Normal` or `Low`, as the conversation warrants. |
| `Due_Date` | Only where the conversation named a date. Never invent one. Plain `YYYY-MM-DD`. |
| `Description` | `note:<note id>` on its own first line, then the clause verbatim. This is the join key of last resort if the custom field below is not added. |
| `CoS_Note_Id` | **Recommended**: a single-line custom field on Tasks holding the note's Zoho id. Add it through the Tasks layout, the way Other Accounts and Priority History were added to Contacts on Oct 28, 2026. It turns the dashboard's join from a text match into an exact one. |

Nothing else. Do not set an Owner the conversation did not name, and do not write to any module but Tasks.

## Idempotency

The hourly run must not create a second task for a note it already handled. Before creating, look for an existing task
on that contact whose `CoS_Note_Id` is the note's id (or, without that field, whose `Description` first line is
`note:<note id>`). If one exists, update it rather than creating another.

A note is never rewritten by the bot today, so a task's text should not need updating after creation. If a note *is*
re-filed with a changed clause, update the task's Subject and leave its Status alone — a human may already have closed
it.

## Closing

This is the part that makes the done state real, and the only part the dashboard cannot infer:

- When the bot sees the work done in a later conversation, set `Status` to `Completed`.
- When a later note on the same contact supersedes the clause and the work plainly did not happen, leave the task open
  and let it age. The dashboard already drops the superseded clause from its list and keeps it on the person's brief;
  an open task that nobody closed is a true signal, not noise.
- Never delete a task to express "done". The dashboard reads Completed; a deleted task is indistinguishable from one
  that never existed.

## Priority: say something, or say nothing

Every Zoho Task in the CRM today reads `Priority: High` — the field has been set the same way on all of them, so it
carries no information. That is why the dashboard derives its own priority from the clause's wording and age rather than
reading the Task. If the bot starts setting Priority meaningfully, the dashboard will prefer it and fall back to the
derived value; if it is going to be High on everything, leave it at the Zoho default instead, and the derived priority
stays in charge.

## Never

- Never put an email address or a phone number in a Subject or Description. The notes are scrubbed at source, so a
  clause should already be clean; this is the backstop.
- Never create a task on a contact whose Zoho record is Do Not Contact. The dashboard filters those out of its list and
  a task would put them back into someone's queue.
- Never create a task from a `LinkedIn DM:` note, a Fireflies meeting note, or any note the bot did not write. Only
  `Conversation note:` notes are in scope, and the title prefix is the only thing that tells them apart — every note in
  this CRM is created by the same shared Transpire login, so `Created_By` cannot be used as the test.

## What changes on the dashboard when this ships

Three small changes, none of them needed before:

1. A new dataset, `note_tasks`, pulling Tasks of **every** status that carry the `CoS: ` subject prefix. Today's
   `open_tasks` is `Status != 'Completed'`, so a completed task is absent from it and the panel cannot tell a finished
   item from one that never had a task. This is the dataset that makes Done visible.
2. `taskFor` in `artifact/notes-engine.js` joins on `CoS_Note_Id` (or the `note:<id>` Description line) instead of the
   wording-containment test, and the engine gains a `done` state.
3. The panel's **In Zoho** column reads Done / Still open / No task instead of Still open / No task, and `priorityOf`
   prefers the Task's Priority where it is set to something other than High-on-everything.

## Checklist after implementing

- One note, one task: re-run the hourly job twice and confirm no duplicate appears.
- A clause that is purely their move creates no task.
- A Do Not Contact record creates no task.
- A clause over 255 characters is trimmed on a word boundary, not mid-word, and the full text survives in the
  Description.
- A task closed by hand in Zoho stays closed across the next run.
- `select Subject, Status, Priority, Due_Date, Who_Id from Tasks where Subject like 'CoS: %'` returns what you expect,
  and no row carries an address or a phone number.
