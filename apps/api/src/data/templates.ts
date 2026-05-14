/**
 * Pre-loaded study templates based on published marketing/behavioral research.
 * Each template is a complete study definition that users can clone.
 */

export interface TemplateCondition {
  name: string;
  description: string;
  order_index: number;
  stimulus_type: "text" | "image" | "both";
  stimulus_text?: string;
}

export interface TemplateQuestion {
  text: string;
  scale_type: "likert" | "continuous" | "categorical" | "open_ended";
  scale_points?: number;
  scale_labels?: Record<string, string>;
  order_index: number;
}

export interface TemplateBenchmark {
  question_order_index: number;
  finding_label: string;
  effect_size: number;
  effect_size_type: string;
  ci_lower?: number;
  ci_upper?: number;
  p_value?: number;
  source_citation?: string;
}

export interface StudyTemplate {
  id: string;
  title: string;
  description: string;
  source_citation: string;
  research_area: string;
  design_summary: string;
  sample_size: number;
  demographic_spec: {
    age_mean: number;
    age_sd: number;
    gender_distribution: Record<string, number>;
    income_distribution: Record<string, number>;
    education_distribution: Record<string, number>;
    occupation_pool: string[];
  };
  study_context: string;
  conditions: TemplateCondition[];
  questions: TemplateQuestion[];
  expected_findings: string;
  question_benchmarks?: TemplateBenchmark[];
}

export const STUDY_TEMPLATES: StudyTemplate[] = [
  {
    id: "packaging-complexity-purchase-intent",
    title: "Packaging Complexity and Purchase Intent",
    description:
      "Replicates research on how packaging visual complexity affects consumer purchase intent and willingness to pay. Participants view either a simple or complex product package and rate their purchase likelihood.",
    source_citation:
      "Based on Reimann et al. (2010). 'Aesthetic Package Design: A Behavioral, Neural, and Psychological Investigation.' Journal of Consumer Psychology.",
    research_area: "Consumer Behavior / Marketing",
    design_summary:
      "2-condition between-subjects design. IV: packaging complexity (simple vs. complex). DVs: purchase intent (7-point Likert), willingness to pay (continuous).",
    sample_size: 200,
    demographic_spec: {
      age_mean: 35,
      age_sd: 10,
      gender_distribution: { male: 0.5, female: 0.5 },
      income_distribution: {
        "under_30k": 0.15,
        "30k_60k": 0.35,
        "60k_100k": 0.35,
        "over_100k": 0.15,
      },
      education_distribution: {
        "high_school": 0.2,
        "some_college": 0.25,
        "bachelors": 0.4,
        "graduate": 0.15,
      },
      occupation_pool: [
        "software engineer", "teacher", "nurse", "sales representative",
        "accountant", "marketing manager", "retail worker", "office administrator",
        "graphic designer", "project manager",
      ],
    },
    study_context:
      "Imagine you are shopping online for a moisturizing hand lotion. You see the following product on a retailer's website. Please answer the questions below based on your first impression.",
    conditions: [
      {
        name: "Simple Packaging",
        description: "A product page for a hand lotion with clean, minimal packaging: white background, single font, brand name and key claim only. The design is uncluttered with generous white space.",
        order_index: 0,
        stimulus_type: "text",
        stimulus_text:
          "Product: PureSkin Hand Lotion (250ml)\nPackaging: Clean white bottle with black text. Brand name: PureSkin. Tagline: 'Deep Moisture.' No additional imagery or decorative elements. Simple cap.",
      },
      {
        name: "Complex Packaging",
        description: "A product page for the same hand lotion with elaborate, decorative packaging featuring multiple colors, patterns, and design elements.",
        order_index: 1,
        stimulus_type: "text",
        stimulus_text:
          "Product: PureSkin Hand Lotion (250ml)\nPackaging: Ornate bottle with floral illustrations, gold trim, multiple font styles, decorative borders. Colors: rose gold, deep teal, cream. Includes ingredient icons, award badges, and multiple callouts ('Dermatologist Tested', 'Vitamin E Enriched', 'Cruelty Free').",
      },
    ],
    questions: [
      {
        text: "How likely are you to purchase this product?",
        scale_type: "likert",
        scale_points: 7,
        scale_labels: {
          "1": "Extremely unlikely",
          "4": "Neither likely nor unlikely",
          "7": "Extremely likely",
        },
        order_index: 0,
      },
      {
        text: "How much would you be willing to pay for this product (in USD)?",
        scale_type: "continuous",
        order_index: 1,
      },
      {
        text: "How would you rate the overall quality of this product based on its appearance?",
        scale_type: "likert",
        scale_points: 7,
        scale_labels: {
          "1": "Very low quality",
          "4": "Moderate quality",
          "7": "Very high quality",
        },
        order_index: 2,
      },
      {
        text: "How aesthetically appealing is this product's packaging?",
        scale_type: "likert",
        scale_points: 7,
        scale_labels: {
          "1": "Not at all appealing",
          "4": "Somewhat appealing",
          "7": "Extremely appealing",
        },
        order_index: 3,
      },
    ],
    expected_findings:
      "Prior research suggests complex packaging is associated with higher perceived quality and willingness to pay, but simple packaging often yields higher purchase intent in online contexts due to reduced cognitive load.",
  },
  {
    id: "message-framing-health-behavior",
    title: "Gain vs. Loss Message Framing and Health Behavior",
    description:
      "Classic prospect theory replication examining whether gain-framed vs. loss-framed health messages produce different intentions to adopt a preventive health behavior.",
    source_citation:
      "Based on Rothman & Salovey (1997). 'Shaping Perceptions to Motivate Healthy Behavior: The Role of Message Framing.' Psychological Bulletin, 121(1), 3-19.",
    research_area: "Health Communication / Behavioral Science",
    design_summary:
      "2-condition between-subjects design. IV: message frame (gain vs. loss). DVs: behavioral intention (7-point Likert), message persuasiveness (7-point Likert), personal relevance.",
    sample_size: 250,
    demographic_spec: {
      age_mean: 38,
      age_sd: 12,
      gender_distribution: { male: 0.48, female: 0.52 },
      income_distribution: {
        "under_30k": 0.2,
        "30k_60k": 0.3,
        "60k_100k": 0.3,
        "over_100k": 0.2,
      },
      education_distribution: {
        "high_school": 0.15,
        "some_college": 0.3,
        "bachelors": 0.4,
        "graduate": 0.15,
      },
      occupation_pool: [
        "office administrator", "teacher", "nurse", "engineer", "freelancer",
        "retail manager", "financial analyst", "social worker", "technician", "consultant",
      ],
    },
    study_context:
      "You are about to read a short public health message about a preventive health screening. Please read it carefully, then answer the questions that follow.",
    conditions: [
      {
        name: "Gain Frame",
        description: "A health message emphasizing the benefits of taking action (what you gain by getting screened).",
        order_index: 0,
        stimulus_type: "text",
        stimulus_text:
          "HEALTH MESSAGE: 'People who get regular colorectal cancer screenings gain the benefit of early detection. Early detection dramatically increases survival rates — over 90% of colorectal cancers are treatable when caught early. Getting screened means staying healthy and continuing to enjoy life with the people you love. Take control of your health by scheduling your screening today.'",
      },
      {
        name: "Loss Frame",
        description: "A health message emphasizing the costs of inaction (what you lose by not getting screened).",
        order_index: 1,
        stimulus_type: "text",
        stimulus_text:
          "HEALTH MESSAGE: 'People who do not get regular colorectal cancer screenings risk losing the chance for early detection. Without early detection, survival rates drop dramatically — over 90% of late-stage colorectal cancers are difficult to treat. Failing to get screened means risking your health and losing precious time with the people you love. Don't lose the chance to protect yourself — schedule your screening today.'",
      },
    ],
    questions: [
      {
        text: "How likely are you to schedule a colorectal cancer screening in the next 6 months?",
        scale_type: "likert",
        scale_points: 7,
        scale_labels: {
          "1": "Extremely unlikely",
          "4": "Neither likely nor unlikely",
          "7": "Extremely likely",
        },
        order_index: 0,
      },
      {
        text: "How persuasive did you find this health message?",
        scale_type: "likert",
        scale_points: 7,
        scale_labels: {
          "1": "Not at all persuasive",
          "4": "Somewhat persuasive",
          "7": "Extremely persuasive",
        },
        order_index: 1,
      },
      {
        text: "How personally relevant is this health message to you?",
        scale_type: "likert",
        scale_points: 7,
        scale_labels: {
          "1": "Not at all relevant",
          "4": "Somewhat relevant",
          "7": "Extremely relevant",
        },
        order_index: 2,
      },
      {
        text: "How much anxiety or concern did this message create for you?",
        scale_type: "likert",
        scale_points: 7,
        scale_labels: {
          "1": "No anxiety at all",
          "4": "Moderate anxiety",
          "7": "Extreme anxiety",
        },
        order_index: 3,
      },
    ],
    expected_findings:
      "Loss frames typically produce stronger behavioral intentions for detection behaviors (e.g., screenings). Gain frames are more effective for prevention behaviors. Both frames expected to differ on persuasiveness ratings.",
  },
  {
    id: "brand-endorser-fit-attitude",
    title: "Celebrity Endorser Congruence and Brand Attitude",
    description:
      "Examines the match-up hypothesis: consumers form more favorable brand attitudes when a celebrity endorser is perceived as congruent with the brand's image versus incongruent.",
    source_citation:
      "Based on Kamins & Gupta (1994). 'Congruence between Spokesperson and Product Type: A Matchup Hypothesis Perspective.' Psychology & Marketing, 11(6), 569-586.",
    research_area: "Advertising / Brand Management",
    design_summary:
      "3-condition between-subjects design. IV: endorser-brand fit (high fit / low fit / no endorser). DVs: brand attitude (7-point Likert), purchase intention, ad credibility.",
    sample_size: 300,
    demographic_spec: {
      age_mean: 28,
      age_sd: 8,
      gender_distribution: { male: 0.45, female: 0.55 },
      income_distribution: {
        "under_30k": 0.25,
        "30k_60k": 0.4,
        "60k_100k": 0.25,
        "over_100k": 0.1,
      },
      education_distribution: {
        "high_school": 0.1,
        "some_college": 0.3,
        "bachelors": 0.45,
        "graduate": 0.15,
      },
      occupation_pool: [
        "student", "marketing coordinator", "graphic designer", "social media manager",
        "barista", "fitness instructor", "journalist", "sales associate",
        "UX designer", "content creator",
      ],
    },
    study_context:
      "You are about to see an advertisement for a sports performance drink called VeloCharge. Please read the ad carefully and answer the questions that follow.",
    conditions: [
      {
        name: "High Fit Endorser",
        description: "Advertisement features an elite professional marathon runner endorsing VeloCharge sports drink.",
        order_index: 0,
        stimulus_type: "text",
        stimulus_text:
          "ADVERTISEMENT:\nVeloCharge Performance Drink\n\nFeaturing: Jordan Nakamura, 4x Olympic marathon medalist and world record holder.\n\n'Training at the elite level demands peak hydration. VeloCharge delivers the electrolyte balance and rapid absorption I need to push through the final mile. It's not just a drink — it's part of my performance system.'\n\nVeloCharge. Engineered for endurance.\n[Product shown: sleek athletic bottle with electrolyte and performance specs]",
      },
      {
        name: "Low Fit Endorser",
        description: "Advertisement features a celebrity chef (known for rich, indulgent cuisine) endorsing VeloCharge sports drink.",
        order_index: 1,
        stimulus_type: "text",
        stimulus_text:
          "ADVERTISEMENT:\nVeloCharge Performance Drink\n\nFeaturing: Marcus Delacroix, celebrity chef, restaurateur, and host of 'The Indulgent Table' (4 Michelin stars).\n\n'I'm always on the move — between the kitchen, the dining room, and television sets. VeloCharge keeps me going through those long days. A little unconventional for a chef, maybe — but it works for me.'\n\nVeloCharge. Engineered for endurance.\n[Product shown: sleek athletic bottle with electrolyte and performance specs]",
      },
      {
        name: "No Endorser",
        description: "Advertisement for VeloCharge sports drink with no celebrity endorser.",
        order_index: 2,
        stimulus_type: "text",
        stimulus_text:
          "ADVERTISEMENT:\nVeloCharge Performance Drink\n\nFormulated for peak performance.\n\nVeloCharge delivers optimal electrolyte balance with rapid absorption technology — giving you the hydration support to push harder and recover faster.\n\nIdeal for endurance athletes, weekend warriors, and anyone who demands more from their body.\n\nVeloCharge. Engineered for endurance.\n[Product shown: sleek athletic bottle with electrolyte and performance specs]",
      },
    ],
    questions: [
      {
        text: "Overall, how favorable is your attitude toward the VeloCharge brand after seeing this advertisement?",
        scale_type: "likert",
        scale_points: 7,
        scale_labels: {
          "1": "Very unfavorable",
          "4": "Neither favorable nor unfavorable",
          "7": "Very favorable",
        },
        order_index: 0,
      },
      {
        text: "How likely are you to purchase VeloCharge?",
        scale_type: "likert",
        scale_points: 7,
        scale_labels: {
          "1": "Extremely unlikely",
          "4": "Neither likely nor unlikely",
          "7": "Extremely likely",
        },
        order_index: 1,
      },
      {
        text: "How credible do you find this advertisement?",
        scale_type: "likert",
        scale_points: 7,
        scale_labels: {
          "1": "Not at all credible",
          "4": "Somewhat credible",
          "7": "Extremely credible",
        },
        order_index: 2,
      },
      {
        text: "How well does the spokesperson (if any) fit with the VeloCharge brand?",
        scale_type: "likert",
        scale_points: 7,
        scale_labels: {
          "1": "Very poor fit",
          "4": "Moderate fit",
          "7": "Very good fit",
        },
        order_index: 3,
      },
    ],
    expected_findings:
      "High-fit endorser condition expected to produce significantly more favorable brand attitudes and higher purchase intention than low-fit and no-endorser conditions. The low-fit condition may produce less favorable outcomes than even the no-endorser baseline.",
  },
  {
    id: "social-proof-choice-behavior",
    title: "Social Proof and Product Choice Under Uncertainty",
    description:
      "Examines how social proof cues ('bestseller', 'most popular') affect product choice and satisfaction expectations when consumers face high product uncertainty.",
    source_citation:
      "Based on Cialdini (2001). 'Harnessing the Science of Persuasion.' Harvard Business Review; and Chevalier & Mayzlin (2006) on review-driven social influence in e-commerce.",
    research_area: "Consumer Psychology / E-Commerce",
    design_summary:
      "2-condition between-subjects design. IV: social proof cue presence (present vs. absent). DVs: choice confidence (7-point Likert), expected satisfaction, willingness to pay premium.",
    sample_size: 200,
    demographic_spec: {
      age_mean: 33,
      age_sd: 9,
      gender_distribution: { male: 0.5, female: 0.5 },
      income_distribution: {
        "under_30k": 0.2,
        "30k_60k": 0.35,
        "60k_100k": 0.3,
        "over_100k": 0.15,
      },
      education_distribution: {
        "high_school": 0.15,
        "some_college": 0.25,
        "bachelors": 0.45,
        "graduate": 0.15,
      },
      occupation_pool: [
        "software developer", "teacher", "healthcare worker", "financial analyst",
        "marketing professional", "operations manager", "entrepreneur", "accountant",
        "HR professional", "logistics coordinator",
      ],
    },
    study_context:
      "Imagine you are shopping for a new wireless noise-canceling headphone on an e-commerce website. You are not very familiar with the brand. You see the following product listing.",
    conditions: [
      {
        name: "Social Proof Present",
        description: "Product listing includes bestseller badge, review count, and popularity indicators.",
        order_index: 0,
        stimulus_type: "text",
        stimulus_text:
          "PRODUCT LISTING:\nZenAudio ProX Wireless Headphones\nPrice: $149.99\n\n⭐ 4.6/5 stars (12,847 reviews) | #1 Bestseller in Wireless Headphones\n🏆 Amazon's Choice | 'Top Pick' — TechRadar 2024\n📦 Over 50,000 sold this month\n\nFeatures: 40-hour battery life, active noise cancellation, premium drivers, USB-C charging\nAvailable: In stock, ships in 1-2 days",
      },
      {
        name: "Social Proof Absent",
        description: "Product listing with no social proof indicators — neutral product presentation.",
        order_index: 1,
        stimulus_type: "text",
        stimulus_text:
          "PRODUCT LISTING:\nZenAudio ProX Wireless Headphones\nPrice: $149.99\n\nFeatures: 40-hour battery life, active noise cancellation, premium drivers, USB-C charging\nAvailable: In stock, ships in 1-2 days",
      },
    ],
    questions: [
      {
        text: "How confident are you that purchasing these headphones would be a good decision?",
        scale_type: "likert",
        scale_points: 7,
        scale_labels: {
          "1": "Not at all confident",
          "4": "Somewhat confident",
          "7": "Extremely confident",
        },
        order_index: 0,
      },
      {
        text: "How satisfied do you expect to be with this product if you purchased it?",
        scale_type: "likert",
        scale_points: 7,
        scale_labels: {
          "1": "Very dissatisfied",
          "4": "Neither satisfied nor dissatisfied",
          "7": "Very satisfied",
        },
        order_index: 1,
      },
      {
        text: "How likely are you to purchase these headphones?",
        scale_type: "likert",
        scale_points: 7,
        scale_labels: {
          "1": "Extremely unlikely",
          "4": "Neither likely nor unlikely",
          "7": "Extremely likely",
        },
        order_index: 2,
      },
      {
        text: "What is the maximum price premium (in USD above $149.99) you would be willing to pay for this product over a comparable unknown-brand alternative?",
        scale_type: "continuous",
        order_index: 3,
      },
    ],
    expected_findings:
      "Social proof cues expected to significantly increase purchase confidence, expected satisfaction, and purchase intent. Price premium willingness expected to be higher in the social proof condition.",
  },
  {
    id: "arousal-virality-berger-milkman-2012",
    title: "Emotional Arousal and Content Sharing Intent",
    description:
      "Replicates Berger & Milkman (2012)'s key finding that high-arousal emotions (awe, anxiety, anger) drive content sharing more than low-arousal emotions (sadness, contentment). Participants read one of two news articles and rate their sharing intent and emotional response.",
    source_citation:
      "Berger, J., & Milkman, K. L. (2012). What Makes Online Content Viral? Journal of Marketing Research, 49(2), 192–205.",
    research_area: "Media Effects / Communication",
    design_summary:
      "2-condition between-subjects design. IV: article emotional tone (high-arousal awe vs. low-arousal sadness). DVs: sharing intent (2 items), emotional arousal, emotional valence, article interest.",
    sample_size: 200,
    demographic_spec: {
      age_mean: 38,
      age_sd: 13,
      gender_distribution: { male: 0.48, female: 0.52 },
      income_distribution: {
        low: 0.2,
        lower_middle: 0.2,
        middle: 0.3,
        upper_middle: 0.2,
        high: 0.1,
      },
      education_distribution: {
        high_school: 0.2,
        some_college: 0.3,
        bachelors: 0.35,
        masters: 0.12,
        doctorate: 0.03,
      },
      occupation_pool: [
        "teacher", "nurse", "software developer", "accountant", "sales representative",
        "manager", "administrative assistant", "retail worker", "freelancer", "student",
        "engineer", "social worker", "journalist", "chef", "project manager",
      ],
    },
    study_context:
      "You will read a brief news article. Please read it carefully and then answer the questions below. There are no right or wrong answers — we are interested in your honest reactions.",
    conditions: [
      {
        name: "High-Arousal (Awe)",
        description: "An awe-inspiring science article designed to elicit high-arousal positive emotion.",
        order_index: 0,
        stimulus_type: "text",
        stimulus_text:
          "ARTICLE: Scientists Discover Microbes Surviving in the Stratosphere — Rewriting Our Understanding of Life\n\nIn a discovery that has left researchers stunned, a team of astrobiologists has confirmed the presence of living microorganisms thriving 40 kilometers above Earth's surface — deep in the stratosphere, where temperatures plunge to -60°C and ultraviolet radiation is hundreds of times more intense than at sea level.\n\nThe organisms, collected via high-altitude balloon sampling, appear to metabolize trace gases and withstand radiation levels that would kill virtually any known life form. 'We've just moved the boundary of where life can exist,' said lead researcher Dr. Sarah Chen of MIT. 'If life survives here, it changes everything we thought we knew about habitability — on Earth and beyond.'\n\nThe findings suggest that life may be far more tenacious and widespread in extreme environments than previously imagined, potentially reshaping the search for life on other planets. Several of the microbes appear to have no known relatives in any existing genetic database — raising the possibility that they represent an entirely separate branch of Earth's tree of life, evolving in near-isolation for millions of years.\n\n'We keep moving the goalposts for what life requires,' said Dr. James Park, an astrobiologist not involved in the study. 'Every time we do, we find something living right at the new boundary.'",
      },
      {
        name: "Low-Arousal (Sadness)",
        description: "A sad human-interest article designed to elicit low-arousal negative emotion.",
        order_index: 1,
        stimulus_type: "text",
        stimulus_text:
          "ARTICLE: The Long Goodbye: Families Navigate the Quiet Grief of Memory Loss\n\nFor Margaret Tillson, the hardest part wasn't the diagnosis. It was the gradual disappearance — the way her mother, Eleanor, began forgetting her name. First it was small things: where she left her keys, what she had for breakfast. Then, over eighteen slow months, it became everything.\n\n'She would look at me and I could see her searching,' Margaret, 54, said quietly. 'Like she knew she should know me, but couldn't find it anymore.'\n\nAcross the country, an estimated 6.7 million Americans live with Alzheimer's disease, a condition that erases memory gradually but thoroughly. For the families who care for them, the experience is a particular kind of grief — mourning someone who is still present. Caregivers often describe a profound sense of loneliness: friends don't know what to say, the loss is invisible to outsiders, and there is no clear moment to grieve.\n\nEleanor passed away last spring. Margaret keeps a photo of the two of them from fifteen years ago, taken at a family reunion by the shore. 'She was so sharp then,' she says. 'She remembered every birthday, every story. I try to hold onto who she was.' She pauses. 'It just takes a long time to let go.'",
      },
    ],
    questions: [
      {
        text: "How likely are you to share this article with someone you know?",
        scale_type: "likert",
        scale_points: 7,
        scale_labels: {
          "1": "Extremely unlikely",
          "4": "Neither likely nor unlikely",
          "7": "Extremely likely",
        },
        order_index: 0,
      },
      {
        text: "How likely are you to email or send this article to a friend or family member?",
        scale_type: "likert",
        scale_points: 7,
        scale_labels: {
          "1": "Extremely unlikely",
          "4": "Neither likely nor unlikely",
          "7": "Extremely likely",
        },
        order_index: 1,
      },
      {
        text: "How activated or energized do you feel after reading this article?",
        scale_type: "likert",
        scale_points: 7,
        scale_labels: {
          "1": "Not at all activated",
          "4": "Somewhat activated",
          "7": "Extremely activated",
        },
        order_index: 2,
      },
      {
        text: "Overall, how positive or negative did this article make you feel?",
        scale_type: "likert",
        scale_points: 7,
        scale_labels: {
          "1": "Very negative",
          "4": "Neither positive nor negative",
          "7": "Very positive",
        },
        order_index: 3,
      },
      {
        text: "How interesting did you find this article?",
        scale_type: "likert",
        scale_points: 7,
        scale_labels: {
          "1": "Not at all interesting",
          "4": "Somewhat interesting",
          "7": "Extremely interesting",
        },
        order_index: 4,
      },
    ],
    expected_findings:
      "High-arousal (awe) condition expected to produce significantly higher sharing intent than low-arousal (sadness) condition, replicating Berger & Milkman (2012). Arousal activation ratings expected to be higher in the awe condition; valence expected to be more positive in the awe condition. Note: the manipulation confounds arousal and valence — awe is high-arousal positive, sadness is low-arousal negative — so observed differences cannot be attributed to arousal alone. This mirrors the original B&M (2012) Study 2 design; a matched-valence condition (e.g., awe vs. contentment) would be needed to isolate the pure arousal effect.",
    question_benchmarks: [
      {
        question_order_index: 0,
        finding_label: "sharing_intent",
        effect_size: 0.35,
        effect_size_type: "cohens_d",
        ci_lower: 0.10,
        ci_upper: 0.60,
        source_citation: "SME estimate; Willard et al. (2018) arousal-sharing replication; Berger et al. 2013-2018 follow-up work",
      },
      {
        question_order_index: 1,
        finding_label: "email_send_intent",
        effect_size: 0.28,
        effect_size_type: "cohens_d",
        ci_lower: 0.05,
        ci_upper: 0.51,
        source_citation: "SME estimate; correlated with sharing intent (Q1)",
      },
      {
        question_order_index: 2,
        finding_label: "arousal_activation",
        effect_size: 1.10,
        effect_size_type: "cohens_d",
        ci_lower: 0.80,
        ci_upper: 1.40,
        source_citation: "SME estimate; large effect expected for manipulation check; Berger & Milkman (2012) Study 1",
      },
      {
        question_order_index: 3,
        finding_label: "emotional_valence",
        effect_size: 0.42,
        effect_size_type: "cohens_d",
        ci_lower: 0.15,
        ci_upper: 0.65,
        source_citation: "SME estimate; awe (high-arousal positive) vs. sadness (low-arousal negative); B&M (2012) Table 2",
      },
      // Q5 (article interest, order_index 4): no published benchmark — Goal 2 returns null
    ],
  },
];
