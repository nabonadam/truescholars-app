-- Marketplace service categories
INSERT INTO "categories" ("id", "slug", "name") VALUES
  (gen_random_uuid()::text, 'statistics-data-analysis', 'Statistics & data analysis'),
  (gen_random_uuid()::text, 'academic-editing', 'Academic editing & proofreading'),
  (gen_random_uuid()::text, 'research-methodology', 'Research methodology & proposal review'),
  (gen_random_uuid()::text, 'qualitative-analysis', 'Qualitative analysis (coding, NVivo)'),
  (gen_random_uuid()::text, 'literature-review-support', 'Literature review support'),
  (gen_random_uuid()::text, 'transcription', 'Transcription'),
  (gen_random_uuid()::text, 'research-tutoring', 'Research tutoring & mentoring'),
  (gen_random_uuid()::text, 'survey-design', 'Survey & questionnaire design'),
  (gen_random_uuid()::text, 'data-cleaning', 'Data cleaning & management'),
  (gen_random_uuid()::text, 'systematic-reviews', 'Systematic reviews & meta-analysis'),
  (gen_random_uuid()::text, 'research-programming', 'Research programming (R, Python, Stata)'),
  (gen_random_uuid()::text, 'gis-spatial-analysis', 'GIS & spatial analysis'),
  (gen_random_uuid()::text, 'academic-translation', 'Academic translation'),
  (gen_random_uuid()::text, 'references-formatting', 'References & formatting'),
  (gen_random_uuid()::text, 'presentations-posters', 'Presentations & academic posters')
ON CONFLICT ("slug") DO NOTHING;
