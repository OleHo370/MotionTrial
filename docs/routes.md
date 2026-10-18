# Application routes

The current product starts at the [Qi Mirror homepage](http://127.0.0.1:3100/qi-mirror) and the [opening lesson](http://127.0.0.1:8766/first-three.html?step=1). The Next.js app runs on port **3100**; the lesson server runs on **8766** and supplies the Factory and USB endpoints.

## Current experience

| Route | Purpose |
| --- | --- |
| [Qi Mirror](http://127.0.0.1:3100/qi-mirror) | Current landing page with interactive ink, Tai Chi introduction and practice entry points. |
| [Choose a form](http://127.0.0.1:3100/qi-mirror/levels) | The 24-form selection wheel. |
| [Opening lesson](http://127.0.0.1:8766/first-three.html?step=1) | Five-step opening, instructor-video upload, live tracking, spoken coaching, Factory AI Wellness Movement Review and optional USB cues. |
| [Prepare the opening](http://127.0.0.1:3100/qi-mirror/enter?form=1&lesson=opening) | The shared bamboo loading screen, followed by the original port-8766 opening lesson. |
| [Prepare a form](http://127.0.0.1:3100/qi-mirror/enter?form=2) | Preloads the chosen form's video and reference before entering practice. |
| [Step-by-step learning](http://127.0.0.1:3100/qi-mirror/practice?mode=guided&form=2) | Slow demonstrations, held targets and learner-paced progression. |
| [Whole-form practice](http://127.0.0.1:3100/qi-mirror/practice?mode=forms&routine=original24) | Continuous reference practice and the available recording library. |

From the form selector, **form 1 opens `/qi-mirror/enter?form=1&lesson=opening`**, shows the bamboo screen through 100%, then opens the dedicated port-8766 opening lesson. **Forms 2–24 open `/qi-mirror/enter?form=N`**, which prepares their resources and continues to `/qi-mirror/practice?mode=guided&form=N`. The earlier direct `/qi-mirror/enter?form=1` link still prepares the imported guided lesson. The homepage also offers direct step-by-step and whole-form practice links.

## Retained earlier routes

These are earlier interfaces and supporting workflows, **not the current README entry points**. They remain available through secondary navigation and are preserved for existing links, reference provenance and regression checks.

| Route | Earlier experience |
| --- | --- |
| [Original ink cover](http://127.0.0.1:3100/qi-mirror/cover) | **Earlier landing page**; the current landing page is `/qi-mirror`. |
| [Research workspace](http://127.0.0.1:3100/) | Original recording/review queue, with `/assess/new`, `/sessions/[id]` and `/about`. |
| [Original practice](http://127.0.0.1:3100/practice) | Earlier guided and whole-form practice interface. |
| [Earlier levels](http://127.0.0.1:8766/game.html) | Four Point Journey level selector. |
| [Earlier practice](http://127.0.0.1:8766/follow-teacher.html) | Four Point Flow practice. |
| [Paired recording study](http://127.0.0.1:8766/dual-view.html) | Earlier two-view recorded study; also the static server's root default. |
| [Recorded 3D study](http://127.0.0.1:8766/study-3d.html) | Earlier standalone recorded-world-landmark viewer. |

`assessment-six-extract.html`, `recut-six-extract.html` and `speech-feedback-check.html` are extraction or verification tools rather than product landing pages.

Current pages share recorded references, renderer modules, model/WASM files and fonts with earlier workflows. Route age alone is not a reason to remove their underlying assets.
