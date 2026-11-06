/** Skill suggestions per category, used when posting jobs. */
export const SKILL_SUGGESTIONS: Record<string, string[]> = {
  "statistics-data-analysis": ["Stata", "SPSS", "R", "Regression", "Survey weights", "Panel data", "Logistic regression", "SEM"],
  "academic-editing": ["Proofreading", "Copy editing", "Thesis editing", "APA style", "Journal submission", "Plagiarism check"],
  "research-methodology": ["Research design", "Sampling", "Proposal review", "Mixed methods", "Ethics application", "Conceptual framework"],
  "qualitative-analysis": ["NVivo", "Thematic analysis", "Coding", "Grounded theory", "ATLAS.ti", "Interviews", "Focus groups"],
  "literature-review-support": ["Literature search", "Scoping review", "Synthesis", "Zotero", "Mendeley", "Annotated bibliography"],
  transcription: ["Interview transcription", "Verbatim", "Twi", "Ewe", "Dagbani", "Translation + transcription"],
  "research-tutoring": ["Thesis supervision", "Statistics tutoring", "Methods coaching", "Viva preparation"],
  "survey-design": ["Questionnaire design", "KoboToolbox", "ODK", "Google Forms", "Pilot testing", "Likert scales"],
  "data-cleaning": ["Data cleaning", "Excel", "Stata", "R", "Merging datasets", "Codebook"],
  "systematic-reviews": ["PRISMA", "Meta-analysis", "Covidence", "Risk of bias", "Search strategy", "RevMan"],
  "research-programming": ["Python", "R", "Stata do-files", "Web scraping", "Automation", "Shiny"],
  "gis-spatial-analysis": ["ArcGIS", "QGIS", "Remote sensing", "Mapping", "Spatial statistics"],
  "academic-translation": ["French", "English", "Twi", "Arabic", "Back-translation"],
  "references-formatting": ["APA 7", "Harvard", "Chicago", "EndNote", "Formatting", "Table of contents"],
  "presentations-posters": ["PowerPoint", "Conference poster", "Infographics", "Defense slides", "Canva"],
};

export const TITLE_EXAMPLES = [
  "Run a logistic regression in Stata on my DHS survey data",
  "Proofread and format my 80-page master's thesis (APA 7)",
  "Code 20 interview transcripts in NVivo and summarise themes",
  "Review the methodology chapter of my PhD proposal",
];
