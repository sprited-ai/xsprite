# 001 — template-8dir

**Question.** Can a strong image model (nano-banana pro, openai image, zimage/zanime)
fill an 8-direction character sheet *by analogy*, given a cam2portrait-style
template?

**Template layout** (after our earlier cam2portrait emotion-sheet template):

```
┌────────────────┬──────────────────────────────┐
│ example        │ example output:              │
│ reference img  │ 8-dir sprite grid, labeled   │
│                │ (S SW W NW N NE E SE)        │
├────────────────┼──────────────────────────────┤
│ user           │ blank grid, same labels      │
│ reference img  │ (model fills these)          │
└────────────────┴──────────────────────────────┘
```

The example pair teaches the mapping; the blanks invite completion.
cam2portrait proved this works for 9 emotion portraits — this tests whether it
holds for *viewpoint rotation*, which is harder (3D reasoning, not style
transfer).

**Needs**
- [ ] One good example pair: reference image + clean 8-direction sheet of the
      same character (mine from sprite-dx / modern-character-generator assets?)
- [ ] Template compositor script (Pillow): `make_template.py ref.png sheet.png user.png → template.png`
- [ ] Runner against fal nano-banana pro / openai image; same template, N seeds
- [ ] Grade: identity consistency across directions, grid alignment, bg cleanliness

**Success =** ≥6/8 directions usable after Toonout bg removal, identity held.
If it works, flux-fill + much of the comfy graph becomes unnecessary (md item #8 → #7).
