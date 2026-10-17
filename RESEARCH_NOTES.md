# Sources and claim boundaries

Checked during the planning conversation on 2026-10-16. The sponsor starter-kit contents were not successfully retrieved. Do not claim this packet implements an official kit problem or has sponsor approval.

## Sponsor context

HackHarvard official website: https://hhuh.io/

The user's screenshot describes Regeneron's 'Reinvent Clinical Trials' healthcare track, with bottlenecks including trial design, sites, recruitment, site workload, data quality, submissions and analysis. MotionTrial currently targets a hypothesized recording-data-quality/coordinator-review use case. A tool for drug-trial operations is a different claim from a tai chi wellness coach.

## Technical and research references

1. MediaPipe Pose Landmarker Web guide: https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js
   - Browser package/model/WASM setup; per-frame pose estimation. Synchronous video inference can block the main thread; implementation must account for responsiveness.
   - It provides estimated landmarks, not a validated rehab score or a finding that an arm was physically occluded.

2. Corniani et al., Scientific Reports, 2025: https://www.nature.com/articles/s41598-025-93979-2
   - Harvard Medical School/Spaulding and other collaborators. 32 participants, six tai chi movements, IMUs and machine learning. Demonstrates a movement-identification/proficiency-monitoring framework.
   - The reported micro-F1 scores are not our model's accuracy and do not establish that webcam measurements are clinical endpoints. The study uses IMUs, not this proposed MediaPipe implementation.

3. Ma et al., Aging Cell, 2024 issue; first online 2023-10-31: https://onlinelibrary.wiley.com/doi/10.1111/acel.14023
   - Includes Harvard-affiliated researchers and an author affiliated with MIT's Laboratory for Computational Physiology. Long-term-practitioner comparisons show associations with some better functional outcomes. The six-month randomized comparison did not show statistically significant functional improvements.
   - Recent publication does not mean a new independent clinical trial. Do not describe the association as proof of causality or general rehabilitation efficacy.

4. Zhao et al., Stroke, 2022: https://pubmed.ncbi.nlm.nih.gov/35387494/
   - A 12-week randomized trial enrolled 160 subacute stroke survivors; a tailored sitting tai chi program improved several functional outcomes versus an attention control. Participants and caregivers followed a specific program.
   - This is not a Harvard/MIT trial and does not validate our simplified task, webcam measurements or clinical use.

5. FDA final DHT remote-acquisition guidance, December 2023: https://www.fda.gov/regulatory-information/search-fda-guidance-documents/digital-health-technologies-remote-data-acquisition-clinical-investigations
   - Supports remote acquisition as an established research domain, while highlighting technology selection and validation considerations. It is not approval of this prototype.

6. Official OpenAI documentation on long-running Codex tasks: https://developers.openai.com/blog/run-long-horizon-tasks-with-codex
   - The handoff follows a durable specification, small milestones, checkable acceptance criteria and recorded verification. It does not rely on cross-chat memory or a prescribed model name.

## Presentation language

Use: 'Research prototype for recording quality review'; 'estimated landmarks'; 'tracking unavailable'; 'needs human review'; 'local demonstration with consented or synthetic data'.

Avoid: 'clinically validated'; 'FDA approved'; 'AI rehabilitation score'; 'proves recovery'; 'Harvard endorses MotionTrial'; fabricated clinical accuracy or efficiency statistics.
