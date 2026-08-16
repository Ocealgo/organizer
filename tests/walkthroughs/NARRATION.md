# Rep training clips — narration script

Six clips, in the order a rep lives the day. Recorded at phone size, because
that is what a rep holds.

```bash
npm run walkthroughs        # re-record the six clips and the title cards
npm run walkthroughs:film   # stitch them into one mp4 with chapters
```

The stitched film is `tests/walkthroughs/film/ocealgo-rep-training.mp4` — about
three and a quarter minutes, 412x916, with a chapter marker per journey so a
trainer can jump straight to the part somebody is stuck on. Both steps are
regenerated from source; nothing is hand-edited, so a screen change costs a
re-run rather than a re-shoot. Stitching needs ffmpeg on the machine.

Each clip already carries its on-screen captions, so it is watchable as-is. This
script is what a human would say over the top — longer and warmer than a caption
can be.

```bash
npm run walkthroughs:narrate   # speak the quoted lines, one wav per chapter
```

**The quoted lines have to fit their clip.** The heading on each chapter is how
long that chapter is on screen, and the narration is mixed in starting at the
title card. Overrun it and the film holds a frozen frame waiting for the voice
to finish, which the stitcher will tell you about. Roughly two and a half words
a second is the budget — the passages below are written to it, so if you add a
sentence, take one out. Only the quoted lines are spoken; the bold notes are for
whoever is running the session.

**Re-record rather than re-shoot.** When a screen changes, change the script and
run it again. That is the whole reason these are scripted instead of captured by
hand.

---

## 01 — Signing in _(25s on screen)_

> This is the Ocealgo app. Your admin creates your account — sign in with the
> email they set up.
>
> The first line on the home screen tells you what today looks like. Read it
> first.
>
> Below that: **Today**, what you do every day. **Trade**, your shops and credit.
> **Yours**, your own record.

**Worth saying over the top:** you never register yourself, and Show beside the
password field reveals what you typed. Today holds three things, and Yours is
where leave and expenses live.

**If a rep gets stuck:** an account that says "Waiting for approval" is not
broken. An admin has not approved it yet. They do not need to sign up again.

---

## 02 — Starting your day _(28s on screen)_

> Nothing unlocks until you punch in. Your outlet list stays locked until you do.
>
> Your location is recorded in the background. If your phone cannot find it,
> carry on.
>
> Enter the opening meter reading exactly as it shows, then photograph it.
> **The number must be readable** — that photo proves the distance you claim.
> No vehicle? Say so, with a reason.

**The point to land:** the opening reading and the closing reading are the two
ends of your distance claim. A missing one costs you the claim.

---

## 03 — Visiting an outlet _(48s on screen)_

> With your day open, tap Log a visit. Your outlets come up sorted by how close
> they are.
>
> Inside the visit, work down the screen. What is on their shelf. Any competitor
> brand, with its price. If they ordered, switch Book an order on and it is
> raised for you.
>
> Then the outcome. **This is the part your manager actually reads.** Pick what
> happened, and write what was said. Fifteen characters is the minimum, not the
> target — "no stock" tells nobody anything.
>
> Punch out, and on to the next shop.

**The point to land:** the remarks are the visit. Everything else is numbers.
"Owner says the rival brand is running a twenty percent scheme" is what a useful
remark looks like — read that one out if the room needs an example.

**On screen but unsaid:** before punching in, the app shows how far the rep is
from where that shop is registered. That is recorded, not enforced — it never
blocks the visit. Worth pointing at, because reps assume it is a tripwire.

---

## 04 — Adding a shop that is not on your list _(33s on screen)_

> A shop that is not on your list? You do not have to wait for the office.
>
> Search first — half of all duplicates are the same shop spelled differently.
>
> Then Add an outlet. It asks just enough to start visiting them: name, phone,
> area. The rest can be filled in later from Network.
>
> The shop is registered where you are standing. Save, and you drop straight into
> punching in.

**If the phone number is refused:** that shop is already on the system under
another name. Search for it instead of adding it again.

---

## 05 — Logging your expenses _(34s on screen)_

> Expenses live under Yours, in Expense reports. A week at a time.
>
> Each day gets an allowance — HQ local, EX beyond twenty-five kilometres, OS
> overnight. Add anything else: bus fare, food, lodging.
>
> Fuel is different — enter the **distance**, never a rupee figure.
>
> Submit the week when it is done. Nothing to claim? **Say so** — a blank week
> looks like a week you forgot.

**The two that get missed:** fuel is entered as distance only, and it needs your
manager to have set a rate per kilometre first. And "Nothing to claim this week"
is a button — an untouched week is indistinguishable from a forgotten one, and
an admin reviews and clears every submission either way.

---

## 06 — Ending your day _(21s on screen)_

> At the end of the day, come back and close it off.
>
> Enter the closing reading and photograph it, just like the morning. The app
> works out your distance.
>
> **Forget this and the day claims no distance at all.** Make ending the day a
> habit.

**The bit the clip does not say:** the app reminds you at six and closes the day
for you late at night — but a day closed for you records nothing. That is why it
has to be a habit rather than something the app can rescue.

---

## Suggested running order for a session

1. **01** and **02** together — getting in, and the one rule that gates
   everything else.
2. **03** on its own, with time to talk. It is the job.
3. **04** as the answer to "what if the shop isn't there".
4. **05** and **06** together — the two things people forget, for the same
   reason: they happen at the end.
