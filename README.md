# GradeUp

GradeUp displays a student's Genesis course grades, marking periods, category weights, assignments, a GPA estimator, and next-year course planning using the SBHS 2026–27 catalog.

## Project files

```text
gradeup/
├── api/
│   └── sync.js
├── index.html
└── vercel.json
```

## Recent interface updates

- Shows the Genesis username entered at login in an Account dropdown.
- Adds a highlighted Log out button.
- Adds a **Predict** panel on each available course page.
- A prediction requires a score earned, possible points, and one of the course's Genesis categories.
- Calculates the current course average from the weighted Genesis category averages, rather than the rounded whole-number course heading.
- Calculates the temporary updated category average from readable scored assignment point totals, then applies the Genesis category weight to the unrounded weighted course average.
- Displays the before/after prediction to one decimal place for comparison with grade-calculator displays.
- Applies the attached South Brunswick grading scale to GradeUp's displayed grade letters: A (93–100), A− (90–92), B+ (87–89), B (83–86), B− (80–82), C+ (77–79), C (73–76), C− (70–72), D (65–69), F (0–64).

Predictions are estimates only. They are not saved as real assignments and do not change Genesis. If Genesis does not provide enough readable score data to make a reliable estimate, or the visible assignment points do not reconcile with Genesis's category average, GradeUp displays an explanation instead of inventing a result.

## Current app features

- Keeps the three main tabs: **Home**, **Goals**, and **GPA**.
- **Home** retains Genesis course grades, marking-period selection, category averages, assignments, and Predict.
- **Goals** identifies the student's current courses from the Genesis sync, asks for the grade they will enter next year, and lets them search/save/edit next-year course preferences using the 254 course records extracted from the uploaded SBHS 2026–27 catalog.
- Next-year course preferences and current-course GPA weighting choices are saved in browser local storage, scoped to the Genesis username. They remain on that browser after logout; they are not synced between devices or stored on the GradeUp server.
- Course eligibility is intentionally conservative. Missing transcript history, recommendations, placement, Academy enrollment, or parent/guardian approvals are labeled **Needs review** rather than reported as confirmed eligibility.
- **GPA** shows weighted and unweighted estimates for the selected marking period and for the full year (averaging the available MP1–MP4 grades for each course). The student can set each current course to Regular, Honors, or AP/College-level.
- GPA estimates use catalog credits when a course can be matched and assume 5.0 credits when a match is not found. They are not official transcript GPA calculations: SBHS calculates official GPA from final course grades and potential credits.
- Honors adds 0.5 and AP/College-level adds 1.0 to grade points for C− or better. D/F grades receive no weighting. Pass/fail and approved Option II courses may be excluded under SBHS rules; the live marking-period data does not always provide enough detail to identify every exception.
- All displayed grade averages are rounded to one decimal place; underlying values remain unrounded for calculations.

## Deploying

1. Keep `index.html` and `vercel.json` in the repository root.
2. Keep `sync.js` inside the `api` folder.
3. Commit the updated files to GitHub.
4. In Vercel, deploy the connected repository again (or wait for its GitHub-triggered deployment).

Use GradeUp only with your own Genesis account and any required district authorization. The Account dropdown shows the username entered during login; it does not display or store the password.
