# Judging

The DOGFOOD specification requires weighted scoring and cross judge normalization but does not prescribe a rubric schema, weighting defaults, normalization formula, or CSV columns. This implementation's choices are documented here.

## Rubric and weighted score

The rubric configuration accepts a `criteria` mapping whose keys are criterion names and whose numeric values are weights. Fixture criteria are loaded as-is; the initial weight for each observed criterion is `1.0` because the fixture contains scores but no weights. The weighted score for a review is the sum of each available criterion score times its configured weight, divided by the sum of weights for those available criteria. Missing fixture scores remain missing and are not fabricated.

The fixture supplies judge-to-track associations but no explicit judge assignment list, so fixture assignments are generated for each judge and submitted project sharing a track. The fixture JSON has no review-batch records; progress is represented by assigned, completed, and pending review counts per project.

## Cross judge normalization

For each judge, compute each available project's weighted score. Compute that judge's population mean and population standard deviation over the scores they supplied. Transform each score to `3 + (score - mean) / standard_deviation`, then clamp the result to the inclusive range 1 through 5. Average the transformed judge values per project. A judge with fewer than two scores or zero standard deviation contributes the neutral value `3.0` for each of their observed reviews. Missing reviews do not contribute values.

This is the implementation's deterministic method, not a formula specified by DOGFOOD. It handles a judge who gives identical scores without dividing by zero.

## CSV representation

The organizer-only `/api/export.csv` response uses the header `project_id,judge_id,criteria,comment`. The criteria mapping is serialized in the CSV cell by Python's CSV writer. The specification requires a CSV response but does not prescribe columns.