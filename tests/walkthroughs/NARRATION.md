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
can be. Timings are approximate; the captions are the anchor.

**Re-record rather than re-shoot.** When a screen changes, change the script and
run it again. That is the whole reason these are scripted instead of captured by
hand.

---

## 01 — Signing in _(~30s)_

> This is the Ocealgo app on your phone. Your admin creates your account, so you
> sign in with the email they set up — you do not register yourself.
>
> If you are not sure what you typed, tap Show next to the password.
>
> The first line on the home screen always tells you what today looks like. Read
> that line first, every time. Right now it says you have not started your day.
>
> Underneath, the screen is in three parts. **Today** is the three things you do
> every day. **Trade** is your network of shops, your stock and the credit book.
> **Yours** is your own record — what you have logged, your leave, your expenses.

**If a rep gets stuck:** an account that says "Waiting for approval" is not
broken. An admin has not approved it yet. They do not need to sign up again.

---

## 02 — Starting your day _(~26s)_

> Nothing unlocks until you punch in. Your outlet list stays locked, and you
> cannot log a visit, until you have started the day.
>
> Your location is recorded quietly in the background. If your phone cannot find
> it, carry on anyway — the day is simply recorded without one. It never stops
> you working.
>
> Tell the app about your vehicle meter, then type the opening reading exactly as
> it shows. Then photograph it. **The number has to be readable in the photo** —
> that photo is what proves the distance you claim at the end of the day.
>
> No vehicle today, or a broken meter? Say so instead, and write a short reason.

**The point to land:** the opening reading and the closing reading are the two
ends of your distance claim. A missing one costs you the claim.

---

## 03 — Visiting an outlet _(~45s)_

> With your day open, tap Log a visit. Your outlets come up sorted by how close
> they are to you right now, so the shop you are standing in is usually first.
>
> Before you punch in, it tells you how far you are from where that shop is
> registered. That is recorded, not enforced — it never stops you.
>
> Inside the visit, work down the screen. What is on their shelf. Any competitor
> brand you can see, with its price if it is on the pack. If they ordered, switch
> Book an order on and the order is raised for you — you do not raise it
> separately afterwards.
>
> Then the outcome. **This is the part your manager actually reads.** Pick what
> happened, and write what was said. Fifteen characters is the minimum, not the
> target — "no stock" tells nobody anything; "owner says the rival brand is
> running a twenty percent scheme" tells them everything.
>
> Punch out, and on to the next shop.

**The point to land:** the remarks are the visit. Everything else is numbers.

---

## 04 — Adding a shop that is not on your list _(~30s)_

> Walked into a shop that is not on your list? You do not have to go anywhere
> else, and you do not have to wait for the office.
>
> Search first. Half of all duplicates are the same shop under a slightly
> different spelling, so look before you add.
>
> Then Add an outlet. It asks for just enough to start visiting them — name,
> phone, and the area. The full address, the district and the pincode can be
> filled in later from Network by whoever has time.
>
> The shop is registered exactly where you are standing, so the next person to
> visit knows where it is.
>
> Save, and you drop straight into punching in. No trip back to the office.

**If the phone number is refused:** that shop is already on the system under
another name. Search for it instead of adding it again.

---

## 05 — Logging your expenses _(~30s)_

> Expenses live under Yours, in Expense reports. You work a week at a time.
>
> Each working day gets a daily allowance — HQ if you stayed local, EX if you
> went beyond twenty-five kilometres, OS if you stayed over. Pick the one that
> matches where you actually went.
>
> For anything else, add it against the day: bus fare, food, lodging, printing.
>
> Fuel works differently. If your manager has set a rate per kilometre, you enter
> the **distance** and the app works out the amount. You never type a rupee
> figure for fuel.
>
> When the week is done, submit it. An admin reviews it and clears it, and you
> are told either way.
>
> Had nothing to claim at all that week? **Say so** — tap "Nothing to claim this
> week". A blank week looks exactly like a week you forgot, and nobody can tell
> the difference.

---

## 06 — Ending your day _(~19s)_

> At the end of the day, come back and close it off.
>
> Enter the closing meter reading and photograph it, the same as the morning. The
> app works out your distance from the two numbers.
>
> Sixty-three kilometres, recorded.
>
> **If you forget this, the day claims no distance at all.** The app will remind
> you at six, and close the day for you late at night — but a day closed for you
> records nothing. Make ending the day a habit.

---

## Suggested running order for a session

1. **01** and **02** together — getting in, and the one rule that gates
   everything else.
2. **03** on its own, with time to talk. It is the job.
3. **04** as the answer to "what if the shop isn't there".
4. **05** and **06** together — the two things people forget, for the same
   reason: they happen at the end.
