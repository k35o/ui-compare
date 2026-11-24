---
"ui-compare": minor
---

Targets get human names, and the report speaks in them. Name a target at `before` as `name=target`, such as `"Pricing page=http://localhost:5173/pricing"` or `--story "Button=src/components/Button.stories.tsx"` for one component. The CLI output, `report.html` and the pane show that name; an unnamed page shows its title, or its path when it has none or shares it, and an unnamed component the last segment of its title. An unnamed target shown like another one gets a longer label, such as `a.test/settings`, `dist/index.html` or `Example/Button`. `review.json` keeps the full URL or component title in `screen.target`. The report's wording no longer uses internal terms such as screens, noise or skipped, and shows the run id only in the page title.
