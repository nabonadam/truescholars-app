/** Starter studies for Qualitative Studio, and a sample study with invented answers to try analysis on. */

import type { DB } from "@/db";
import { qualResponses } from "@/db/schema";
import { newQuestion, type Answers, type Question } from "@/lib/qual";
import { createStudy, publishStudy } from "./qual";

const Q = (type: Question["type"], text: string, extra: Partial<Question> = {}): Question => ({ ...newQuestion(type), text, ...extra });

export const TEMPLATES = {
  blank: { title: "Untitled study", blurb: "Start from an empty survey.", questions: () => [] as Question[] },
  lived: {
    title: "Lived experience interview",
    blurb: "Six open voice questions about a person’s experience of an issue, with short background questions.",
    questions: () => [
      Q("section", "About you"),
      Q("choice", "What is your gender?", { options: ["Woman", "Man", "Prefer to self-describe", "Prefer not to say"] }),
      Q("dropdown", "What is your age group?", { options: ["18–24", "25–34", "35–44", "45–54", "55–64", "65 or older"] }),
      Q("text", "Where do you live (town or district)?"),
      Q("section", "Your experience", { help: "Speak as you would in a conversation. There are no right or wrong answers." }),
      Q("voice", "Tell us a little about yourself and your daily life."),
      Q("voice", "When did this issue first become part of your life? What happened?"),
      Q("voice", "How does it affect you and the people close to you today?"),
      Q("voice", "What have you done to cope with it, and what has helped?"),
      Q("voice", "What has made things harder?"),
      Q("voice", "If you could change one thing, what would it be and why?"),
    ],
  },
  needs: {
    title: "Community needs assessment",
    blurb: "Priorities, barriers and local knowledge, for NGOs and development projects.",
    questions: () => [
      Q("section", "About you"),
      Q("choice", "What is your gender?", { options: ["Woman", "Man", "Prefer not to say"] }),
      Q("dropdown", "What is your age group?", { options: ["18–24", "25–34", "35–44", "45–54", "55 or older"] }),
      Q("text", "Which community do you live in?"),
      Q("section", "Your community"),
      Q("voice", "What are the biggest challenges facing your community right now?"),
      Q("voice", "Which of these affects you or your family most, and how?"),
      Q("voice", "What stops people from getting the services they need, such as health, water or education?"),
      Q("voice", "What does your community already do well that others could learn from?"),
      Q("multi", "Which areas should a new project focus on? Choose all that apply.", { options: ["Health", "Water and sanitation", "Education", "Jobs and income", "Farming", "Roads and transport", "Safety"] }),
      Q("voice", "What advice would you give an organisation that wants to help here?", { required: false }),
    ],
  },
  evaluation: {
    title: "Programme evaluation (participants)",
    blurb: "What participants gained from a programme, what worked and what to change.",
    questions: () => [
      Q("choice", "How did you take part in the programme?", { options: ["In person", "Online", "Both"] }),
      Q("rating", "Overall, how useful was the programme for you?", { scaleMax: 5, minLabel: "Not useful", maxLabel: "Very useful" }),
      Q("voice", "What did you hope to get from the programme when you joined?"),
      Q("voice", "What is the most important thing you gained? Please give an example."),
      Q("voice", "What has changed in your work or life since taking part?"),
      Q("voice", "What did not work well, or what was missing?"),
      Q("voice", "What should we change for the next group?"),
    ],
  },
} as const;
export type TemplateKey = keyof typeof TEMPLATES;

export async function createFromTemplate(db: DB, ownerId: string, key: TemplateKey) {
  const t = TEMPLATES[key] ?? TEMPLATES.blank;
  return createStudy(db, ownerId, { title: t.title, questions: t.questions() });
}

// ───────── the sample study (invented answers) ─────────

const SAMPLE_QS = () => [
  Q("section", "About you"),
  Q("choice", "Which region do you farm in?", { options: ["Upper West", "Upper East", "Northern"] }),
  Q("choice", "What is your gender?", { options: ["Woman", "Man"] }),
  Q("dropdown", "How long have you been farming?", { options: ["Less than 10 years", "10–20 years", "More than 20 years"] }),
  Q("section", "Rainfall and your farm"),
  Q("voice", "How has the rainfall changed since you started farming?"),
  Q("voice", "How have these changes affected your farm and your household?"),
  Q("voice", "What have you done to cope or adapt?"),
  Q("voice", "What support would help you most?"),
];

/** Invented answers from eight farmers, typed as if transcribed. Clearly labelled as example data. */
const SAMPLE: [string, string, string, string, string[]][] = [
  ["Abiba", "Upper West", "Woman", "More than 20 years", [
    "When I started, the rains came in April and we knew when to plant. Now they start, stop for three weeks, then come back. Last year the first rains fooled us and the seeds died in the ground.",
    "We lost almost half of the groundnuts two years ago. When the harvest is small I sell my shea butter early to buy maize for the children, and the money for school fees becomes a problem.",
    "I now plant in two rounds so that if the first planting fails I still have seed. I also joined a women's group that saves money together, so we can borrow when the harvest is poor.",
    "Seeds that can stand the dry spells, and someone to tell us early when the rain will come. The radio forecast is for the whole region, not for my village.",
  ]],
  ["Yakubu", "Upper East", "Man", "More than 20 years", [
    "The rain is shorter now. In my father's time it rained until October. Now by September it is finished, and when it comes it comes heavy and washes the soil away.",
    "The early millet is fine but the late crops do not finish. Some years we eat only twice a day from March until the new harvest. Two of my sons have gone to Kumasi to find work.",
    "We dig stone lines across the farm to keep the water and the soil. I also keep more goats now, because animals can be sold when the crops fail.",
    "Credit for a small pump so we can farm in the dry season near the dam. And good prices for what we sell; the middlemen decide everything.",
  ]],
  ["Mariama", "Northern", "Woman", "10–20 years", [
    "It is not that there is less rain, it is that you cannot trust it. One week floods, the next week nothing. The heat is also stronger; the leaves dry in the afternoon.",
    "The flood last year took my rice field. I had borrowed money for fertiliser and I am still paying. When the farm fails it is the women who must find food, because we cook.",
    "I started growing vegetables near the house where I can water them by hand. I sell okra and pepper in the market and that money is mine.",
    "Land near water for women. The men own the good land by the river. Also training on the new seeds, because the agricultural officer rarely comes here.",
  ]],
  ["Issahaku", "Upper West", "Man", "Less than 10 years", [
    "I have only farmed for eight years but even I can see it. The first rains are late and the dry spells in July are longer. My uncle says the seasons have moved.",
    "My yields go up and down so much that I cannot plan. One year I could buy a motorbike, the next year I sold it to buy food. That makes it hard to invest.",
    "I use my phone to check the weather app and I ask other young farmers on WhatsApp what they are planting. We try new varieties from the research station.",
    "Insurance, so that a bad year does not wipe everything out. And better roads; in the rainy season we cannot even take our produce to market.",
  ]],
  ["Fati", "Upper East", "Woman", "More than 20 years", [
    "The rains used to be gentle and long. Now they are short and angry. The river dries earlier, and the women walk further for water in the dry season.",
    "With less harvest, more young people leave for the south. In my house only the old people and the small children remain to farm. The work is too much for us.",
    "We pray, and we also follow what the elders say about the signs: the trees flowering, the birds. I plant early millet and sorghum because they need less water.",
    "Water. A borehole or a small dam would change everything for us. With water we can farm in the dry season and the young ones would stay.",
  ]],
  ["Alhassan", "Northern", "Man", "10–20 years", [
    "The rainy season starts late and ends suddenly. We used to plant maize in May; now we wait until June and sometimes it is still not enough.",
    "Maize is the crop that suffers most. I have reduced my maize and increased soybeans. My income is less certain and I have taken loans I cannot always repay on time.",
    "I use the drought-tolerant maize and I plant soybeans, which fix the soil. I also do some charcoal burning in the dry season, though I know it destroys the trees.",
    "Tractor services on time. When the rain finally comes everyone needs the tractor in the same week, and the small farmers are served last.",
  ]],
  ["Sala", "Upper West", "Woman", "10–20 years", [
    "The rain is unpredictable. It can rain heavily in one village and nothing in the next. My farm is on the hill, so the water runs off quickly.",
    "When crops fail my husband travels to Techiman to work and I manage the farm and the children alone. It is a heavy load and sometimes there is not enough food.",
    "Our group learned to make compost and we mulch with crop residue to keep the soil wet. It works, but it needs labour and we are few.",
    "Childcare support or a community nursery so women have time for the farm and for training. And a market where we can sell together and get a fair price.",
  ]],
  ["Daniel", "Upper East", "Man", "Less than 10 years", [
    "I think the rain has reduced, and the temperature is very high. The harmattan is also stronger. The old people say these changes started twenty years ago.",
    "I lost my onion crop because the dam dried before harvest. I had to move to my brother's house in the city for some months to work as a labourer.",
    "I came back and started rearing poultry, because it does not depend on rain. I still farm, but smaller, and I put the money from chickens into the farm.",
    "Information. If we knew the season forecast before planting we would choose the right crops. And small loans without asking for land documents, because young people have none.",
  ]],
];

export async function createSampleStudy(db: DB, ownerId: string) {
  const qs = SAMPLE_QS();
  const id = await createStudy(db, ownerId, {
    title: "Sample: farmers and changing rainfall (example data)",
    questions: qs,
    intro: "This is a sample study with invented answers from eight farmers in Northern Ghana. Use it to try transcripts, exports and thematic analysis. Nothing here is real data.",
  });
  await publishStudy(db, ownerId, id);
  const [region, gender, years, ...voice] = qs.filter((q) => q.type !== "section");
  const start = Date.now() - SAMPLE.length * 3_600_000;
  await db.insert(qualResponses).values(
    SAMPLE.map(([name, r, g, y, said], i) => {
      const answers: Answers = { [region.id]: { choice: r }, [gender.id]: { choice: g }, [years.id]: { choice: y } };
      voice.forEach((q, j) => (answers[q.id] = { text: said[j] }));
      const at = new Date(start + i * 3_600_000);
      return { studyId: id, secret: "sample", name, status: "SUBMITTED", answers, startedAt: at, submittedAt: new Date(at.getTime() + 20 * 60_000), tags: [] };
    }),
  );
  return id;
}
