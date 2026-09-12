/**
 * BARBER_ENGINE_V1
 * backend/scripts/seedFieldAgentTrainingV1.js
 *
 * FA-3.3.1 — DEVELOPMENT/DEV-DB fixture script. Authors and publishes
 * one real v1 Field Agent Training curriculum: all 10 approved
 * modules, English + Hindi translations, knowledge checks, and the 7
 * approved practical scenarios distributed into their matching
 * modules (Acquisition/Onboarding/Booking/KYC-Finance/Troubleshooting)
 * — exactly the FA-3.3 curriculum approved for implementation.
 *
 * Content is grounded in this codebase's ACTUAL backend capabilities
 * (Booking.js's real BOOKING_STATUS lifecycle, KYC's real status
 * values, Salon.js's real approval/staff/chairs shape, WalletLedger/
 * WalletTransaction, Rating engine) — not invented functionality, per
 * the approved plan's explicit instruction. Hindi translations are a
 * good-faith v1 draft to prove the multilingual mechanism end-to-end;
 * flagged in the FA-3.3.1 report as recommended for a linguist review
 * pass before wide field rollout — that review is a content-quality
 * step, not an engine change.
 *
 * Idempotent-ish: running twice creates a NEW version (v2, v3, ...)
 * each time, exactly as the versioning engine is designed to do — it
 * does not try to detect "already seeded". If you only want one
 * canonical dev version, drop TrainingVersion/TrainingModule/
 * TrainingContent collections first.
 *
 * Run:
 *   cd backend
 *   node scripts/seedFieldAgentTrainingV1.js
 */

import "dotenv/config";
import mongoose from "mongoose";
import connectDB from "../config/db.js";
import User from "../models/User.js";
import {
  createDraftVersion,
  addModule,
  addContent,
  updateContent,
  publishVersion,
} from "../modules/fieldAgentTraining/services/trainingContent.service.js";
import { uploadTrainingMedia } from "../modules/fieldAgentTraining/services/mediaDelivery.service.js";
import { MODULE_KEY } from "../modules/fieldAgentTraining/constants/fieldAgentTraining.constants.js";

// 1x1 PNG — enough to exercise the real Cloudinary upload_stream +
// type:"authenticated" + signed-delivery path end to end without
// shipping a real training video into a dev fixture.
const SAMPLE_MEDIA_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

const en = (title, body, extra = {}) => ({ languageCode: "en", title, body, approved: true, ...extra });
const hi = (title, body, extra = {}) => ({ languageCode: "hi", title, body, approved: true, ...extra });

const getOrCreateSeedAdmin = async () => {
  let admin = await User.findOne({ role: "ADMIN", adminLevel: "INDIA", isDeleted: { $ne: true } });
  if (admin) return admin;

  admin = await User.create({
    name: "FA-3.3 Seed Admin",
    phone: "9999900001",
    role: "ADMIN",
    adminLevel: "INDIA",
    isActive: true,
  });
  console.log("ℹ️  No INDIA admin found — created dev fixture admin", admin._id.toString());
  return admin;
};

// ─── CURRICULUM DEFINITION ─────────────────────────────────────────

const CURRICULUM = [
  {
    moduleKey: MODULE_KEY.FOUNDATION,
    title: [en("ZEMISH Foundation"), hi("ज़ेमिश परिचय")],
    content: [
      {
        contentType: "LESSON",
        translations: [
          en(
            "What is ZEMISH?",
            "ZEMISH connects customers who need a salon appointment (User App) with salons that operate chairs, staff, and services (Salon App). A Field Agent's job is to bring real salons onto ZEMISH, get them fully configured, and support them so bookings flow smoothly. You represent ZEMISH in person — your conduct and accuracy directly affect trust in the platform."
          ),
          hi(
            "ज़ेमिश क्या है?",
            "ज़ेमिश उन ग्राहकों को (यूज़र ऐप) उन सैलून से जोड़ता है (सैलून ऐप) जो चेयर, स्टाफ़ और सेवाएँ संचालित करते हैं। फ़ील्ड एजेंट का काम है असली सैलून को ज़ेमिश पर लाना, उन्हें पूरी तरह कॉन्फ़िगर करवाना, और उन्हें सहयोग देना ताकि बुकिंग सुचारू रूप से चले। आप व्यक्तिगत रूप से ज़ेमिश का प्रतिनिधित्व करते हैं — आपका आचरण और सटीकता सीधे प्लेटफ़ॉर्म पर भरोसे को प्रभावित करते हैं।"
          ),
        ],
      },
      {
        contentType: "LESSON",
        translations: [
          en(
            "Your authority and limits",
            "A Field Agent can: explain ZEMISH, help owners register and configure their salon, and provide first-line operational support. A Field Agent CANNOT: approve KYC, override commission/fee rules, make financial commitments not in official ZEMISH policy, or resolve payment disputes directly. Anything outside your authority goes to ZEMISH Support (see Module 8)."
          ),
          hi(
            "आपका अधिकार क्षेत्र और सीमाएँ",
            "एक फ़ील्ड एजेंट यह कर सकता है: ज़ेमिश समझाना, मालिक को रजिस्टर व कॉन्फ़िगर करने में मदद करना, और प्रथम-स्तरीय परिचालन सहायता देना। एक फ़ील्ड एजेंट यह नहीं कर सकता: केवाईसी स्वीकृत करना, कमीशन/शुल्क नियमों को बदलना, आधिकारिक नीति से बाहर वित्तीय वादे करना, या भुगतान विवाद सीधे सुलझाना। आपके अधिकार से बाहर की हर बात ज़ेमिश सपोर्ट (मॉड्यूल 8 देखें) के पास जाती है।"
          ),
        ],
      },
      {
        contentType: "KNOWLEDGE_CHECK",
        translations: [
          en("Check your understanding", "Can a Field Agent approve a salon owner's KYC themselves?", {
            options: ["Yes, if the documents look correct", "No — only ZEMISH's KYC review process can approve KYC"],
          }),
          hi("अपनी समझ जाँचें", "क्या एक फ़ील्ड एजेंट खुद सैलून मालिक की केवाईसी स्वीकृत कर सकता है?", {
            options: ["हाँ, अगर दस्तावेज़ सही लगें", "नहीं — केवल ज़ेमिश की केवाईसी समीक्षा प्रक्रिया ही केवाईसी स्वीकृत कर सकती है"],
          }),
        ],
        grading: { type: "SINGLE_CHOICE", correctOptionIndex: 1 },
      },
    ],
  },

  {
    moduleKey: MODULE_KEY.USER_APP,
    title: [en("The ZEMISH User App"), hi("ज़ेमिश यूज़र ऐप")],
    content: [
      {
        contentType: "LESSON",
        translations: [
          en(
            "How a customer books",
            "A customer discovers salons nearby, opens a salon's detail page (services, chairs, staff, ratings), picks a service, picks an available date/time slot, and confirms the booking. Once confirmed, the booking moves through the same lifecycle used everywhere in ZEMISH: HOLD → CONFIRMED → CHECKED_IN → ONGOING → COMPLETED. A customer can cancel before service starts; a completed booking can be rated and reviewed."
          ),
          hi(
            "ग्राहक कैसे बुक करता है",
            "एक ग्राहक आस-पास के सैलून खोजता है, सैलून का विवरण पेज खोलता है (सेवाएँ, चेयर, स्टाफ़, रेटिंग), एक सेवा चुनता है, उपलब्ध तारीख़/समय स्लॉट चुनता है, और बुकिंग की पुष्टि करता है। पुष्टि होने के बाद, बुकिंग उसी जीवनचक्र से गुज़रती है जो पूरे ज़ेमिश में उपयोग होता है: HOLD → CONFIRMED → CHECKED_IN → ONGOING → COMPLETED। ग्राहक सेवा शुरू होने से पहले रद्द कर सकता है; पूर्ण हुई बुकिंग को रेट और रिव्यू किया जा सकता है।"
          ),
        ],
      },
      {
        contentType: "KNOWLEDGE_CHECK",
        translations: [
          en("Check your understanding", "What must be true before a customer can rate a booking?", {
            options: ["The booking must be COMPLETED", "The booking must be CONFIRMED"],
          }),
          hi("अपनी समझ जाँचें", "ग्राहक द्वारा बुकिंग रेट करने से पहले क्या सत्य होना चाहिए?", {
            options: ["बुकिंग COMPLETED होनी चाहिए", "बुकिंग CONFIRMED होनी चाहिए"],
          }),
        ],
        grading: { type: "SINGLE_CHOICE", correctOptionIndex: 0 },
      },
    ],
  },

  {
    moduleKey: MODULE_KEY.SALON_APP,
    title: [en("Complete Salon App Operational Knowledge"), hi("सैलून ऐप की पूर्ण परिचालन जानकारी")],
    content: [
      {
        contentType: "LESSON",
        translations: [
          en(
            "What the owner configures",
            "A salon owner's profile holds basic shop info, location, the services they offer with price and duration, the chairs available, and the staff assigned to those chairs. Correct chair/staff/schedule setup is what allows the booking engine to actually offer real, bookable time slots to customers — an incomplete setup means customers see no availability."
          ),
          hi(
            "मालिक क्या कॉन्फ़िगर करता है",
            "सैलून मालिक की प्रोफ़ाइल में बुनियादी दुकान जानकारी, स्थान, मूल्य व अवधि सहित दी जाने वाली सेवाएँ, उपलब्ध चेयर, और उन चेयर पर नियुक्त स्टाफ़ होता है। सही चेयर/स्टाफ़/शेड्यूल सेटअप ही बुकिंग इंजन को ग्राहकों को वास्तविक, बुक करने योग्य समय स्लॉट दिखाने देता है — अधूरा सेटअप मतलब ग्राहकों को कोई उपलब्धता नहीं दिखती।"
          ),
        ],
      },
      {
        contentType: "LESSON",
        translations: [
          en(
            "Earnings, KYC and ratings inside the Salon App",
            "Completed bookings credit the salon's wallet; the owner can see this ledger inside the app. KYC must be approved before a salon can fully operate. Customer ratings/reviews on completed bookings are visible to the owner and affect discovery ranking — explaining this helps owners understand why service quality matters commercially, not just as advice."
          ),
          hi(
            "सैलून ऐप में कमाई, केवाईसी और रेटिंग",
            "पूर्ण हुई बुकिंग सैलून के वॉलेट में जमा होती है; मालिक ऐप में यह लेजर देख सकता है। सैलून के पूर्ण रूप से संचालित होने से पहले केवाईसी स्वीकृत होनी चाहिए। पूर्ण बुकिंग पर ग्राहक की रेटिंग/रिव्यू मालिक को दिखते हैं और डिस्कवरी रैंकिंग को प्रभावित करते हैं — यह समझाना मालिक को यह समझने में मदद करता है कि सेवा गुणवत्ता क्यों केवल सलाह नहीं बल्कि व्यावसायिक रूप से मायने रखती है।"
          ),
        ],
      },
      {
        contentType: "KNOWLEDGE_CHECK",
        translations: [
          en("Check your understanding", "Why might a fully KYC-approved salon still show no bookable slots?", {
            options: ["Chairs/staff/schedule are not correctly configured", "This never happens once KYC is approved"],
          }),
          hi("अपनी समझ जाँचें", "केवाईसी स्वीकृत सैलून में भी बुक करने योग्य स्लॉट क्यों नहीं दिख सकते?", {
            options: ["चेयर/स्टाफ़/शेड्यूल सही से कॉन्फ़िगर नहीं है", "केवाईसी स्वीकृत होने के बाद ऐसा कभी नहीं होता"],
          }),
        ],
        grading: { type: "SINGLE_CHOICE", correctOptionIndex: 0 },
      },
    ],
  },

  {
    moduleKey: MODULE_KEY.SALON_ACQUISITION,
    title: [en("Salon Acquisition"), hi("सैलून अधिग्रहण")],
    content: [
      {
        contentType: "LESSON",
        translations: [
          en(
            "Approaching an owner",
            "Identify salons that don't yet use ZEMISH, prepare basic facts about the salon before visiting, and open with a short, honest introduction: who you are, who ZEMISH is, and the concrete benefit (more customers, organized bookings, digital payments record). Never claim guaranteed earnings or make up numbers — use only officially published commission/fee information."
          ),
          hi(
            "मालिक से संपर्क",
            "उन सैलून की पहचान करें जो अभी ज़ेमिश का उपयोग नहीं करते, विज़िट से पहले सैलून की बुनियादी जानकारी तैयार करें, और एक छोटी, ईमानदार शुरुआत करें: आप कौन हैं, ज़ेमिश क्या है, और ठोस लाभ (अधिक ग्राहक, व्यवस्थित बुकिंग, डिजिटल भुगतान रिकॉर्ड)। कभी भी गारंटीड कमाई का दावा न करें या आंकड़े न गढ़ें — केवल आधिकारिक रूप से प्रकाशित कमीशन/शुल्क जानकारी का उपयोग करें।"
          ),
        ],
      },
      {
        contentType: "PRACTICAL_SCENARIO",
        helpEligible: false,
        translations: [
          en(
            "Handle a common owner objection",
            "An owner says: \"Why should I pay ZEMISH a commission when I can get customers on my own?\" Which response is approved?",
            {
              options: [
                "\"ZEMISH doesn't just bring customers — it organizes your bookings, reduces no-shows with confirmed slots, and gives you a digital earnings record, for the officially published commission rate.\"",
                "\"Don't worry, I can get you a lower rate than what's published if you sign today.\"",
              ],
            }
          ),
          hi(
            "एक सामान्य आपत्ति संभालें",
            "मालिक कहता है: \"मैं ज़ेमिश को कमीशन क्यों दूँ जब मैं खुद ग्राहक ला सकता हूँ?\" कौन सा जवाब स्वीकृत है?",
            {
              options: [
                "\"ज़ेमिश सिर्फ़ ग्राहक ही नहीं लाता — यह आपकी बुकिंग व्यवस्थित करता है, पुष्ट स्लॉट से नो-शो घटाता है, और आधिकारिक प्रकाशित कमीशन दर पर आपको डिजिटल कमाई रिकॉर्ड देता है।\"",
                "\"चिंता मत करो, अगर आप आज साइन करें तो मैं प्रकाशित दर से कम दर दिला सकता हूँ।\"",
              ],
            }
          ),
        ],
        grading: { type: "SINGLE_CHOICE", correctOptionIndex: 0 },
      },
    ],
  },

  {
    moduleKey: MODULE_KEY.SALON_ONBOARDING,
    title: [en("Complete Salon Onboarding"), hi("पूर्ण सैलून ऑनबोर्डिंग")],
    content: [
      {
        contentType: "LESSON",
        translations: [
          en(
            "Zero to activation",
            "The onboarding path is: owner registration → mobile OTP verification → owner/profile details → salon details and location → services with price and duration → chairs and staff → weekly schedule/availability → KYC submission → operational readiness check → activation. For each step: know WHAT it is, HOW to do it in the app, WHY it matters, common problems you can fix yourself, and when to escalate instead."
          ),
          hi(
            "शून्य से सक्रियण तक",
            "ऑनबोर्डिंग पथ है: मालिक पंजीकरण → मोबाइल ओटीपी सत्यापन → मालिक/प्रोफ़ाइल विवरण → सैलून विवरण व स्थान → मूल्य व अवधि सहित सेवाएँ → चेयर व स्टाफ़ → साप्ताहिक शेड्यूल/उपलब्धता → केवाईसी सबमिशन → परिचालन तत्परता जाँच → सक्रियण। हर चरण के लिए जानें: यह क्या है, ऐप में कैसे करें, यह क्यों मायने रखता है, आम समस्याएँ जो आप खुद ठीक कर सकते हैं, और कब इसे आगे भेजना है।"
          ),
        ],
      },
      {
        // CHECKLIST options are index-keyed ("0","1",...) — the
        // option label is language-specific, but its position (and
        // therefore its key) must be authored in identical order
        // across every translation of this item, since grading.
        // correctKeys addresses options by that shared, language-
        // independent index (approved plan requirement: translations
        // never change what counts as correct).
        contentType: "PRACTICAL_SCENARIO",
        translations: [
          en(
            "Onboard a new salon owner",
            "You are sitting with a new owner. Select every step that happens BEFORE 'KYC submission' in the real onboarding order.",
            {
              options: [
                "Owner registration",
                "Mobile OTP verification",
                "Owner/profile details",
                "Salon details & location",
                "Services with price & duration",
                "Chairs & staff",
                "Weekly schedule/availability",
                "KYC submission",
                "Operational readiness check",
                "Activation",
              ],
            }
          ),
          hi(
            "एक नए सैलून मालिक को ऑनबोर्ड करें",
            "आप एक नए मालिक के साथ बैठे हैं। असली ऑनबोर्डिंग क्रम में 'केवाईसी सबमिशन' से पहले होने वाला हर चरण चुनें।",
            {
              options: [
                "मालिक पंजीकरण",
                "मोबाइल ओटीपी सत्यापन",
                "मालिक/प्रोफ़ाइल विवरण",
                "सैलून विवरण व स्थान",
                "मूल्य व अवधि सहित सेवाएँ",
                "चेयर व स्टाफ़",
                "साप्ताहिक शेड्यूल/उपलब्धता",
                "केवाईसी सबमिशन",
                "परिचालन तत्परता जाँच",
                "सक्रियण",
              ],
            }
          ),
        ],
        grading: {
          type: "CHECKLIST",
          correctKeys: ["0", "1", "2", "3", "4", "5", "6"],
        },
      },
      {
        contentType: "PRACTICAL_SCENARIO",
        translations: [
          en(
            "Configure a missing salon schedule",
            "A salon is KYC-approved but shows zero bookable slots. The owner insists chairs and staff are already added. What is the MOST LIKELY missing piece to check next?",
            { options: ["Weekly schedule/availability was never set for the chairs", "The owner's phone number is wrong"] }
          ),
          hi(
            "गुम सैलून शेड्यूल कॉन्फ़िगर करें",
            "एक सैलून केवाईसी-स्वीकृत है पर शून्य बुक करने योग्य स्लॉट दिखाता है। मालिक कहता है चेयर व स्टाफ़ पहले से जुड़े हैं। आगे जाँचने के लिए सबसे संभावित गुम हिस्सा क्या है?",
            { options: ["चेयर के लिए साप्ताहिक शेड्यूल/उपलब्धता कभी सेट नहीं हुई", "मालिक का फ़ोन नंबर गलत है"] }
          ),
        ],
        grading: { type: "SINGLE_CHOICE", correctOptionIndex: 0 },
      },
    ],
  },

  {
    moduleKey: MODULE_KEY.BOOKING_OPERATIONS,
    title: [en("Booking & Daily Salon Operations"), hi("बुकिंग व दैनिक सैलून संचालन")],
    content: [
      {
        contentType: "LESSON",
        translations: [
          en(
            "The real booking lifecycle",
            "HOLD (slot temporarily locked awaiting payment) → CONFIRMED (paid, OTP generated) → CHECKED_IN (customer arrived, OTP verified) → ONGOING (service in progress) → COMPLETED (service finished, salon wallet credited). A booking can also end as CANCELLED, NO_SHOW, or EXPIRED (HOLD timed out without payment) — each frees the chair for other bookings."
          ),
          hi(
            "वास्तविक बुकिंग जीवनचक्र",
            "HOLD (भुगतान की प्रतीक्षा में स्लॉट अस्थायी रूप से लॉक) → CONFIRMED (भुगतान हुआ, ओटीपी जनरेट) → CHECKED_IN (ग्राहक पहुँचा, ओटीपी सत्यापित) → ONGOING (सेवा जारी) → COMPLETED (सेवा पूर्ण, सैलून वॉलेट में क्रेडिट)। बुकिंग CANCELLED, NO_SHOW, या EXPIRED (बिना भुगतान के HOLD समय समाप्त) के रूप में भी समाप्त हो सकती है — हर स्थिति चेयर को अन्य बुकिंग के लिए मुक्त कर देती है।"
          ),
        ],
      },
      {
        contentType: "PRACTICAL_SCENARIO",
        translations: [
          en(
            "Explain the booking lifecycle to an owner",
            "An owner asks: \"A customer paid but never showed up — what happens to my chair and the booking?\" What is the correct explanation?",
            {
              options: [
                "The booking is marked NO_SHOW and the chair is freed for other bookings",
                "The booking stays HOLD forever and the chair is permanently blocked",
              ],
            }
          ),
          hi(
            "मालिक को बुकिंग जीवनचक्र समझाएँ",
            "मालिक पूछता है: \"ग्राहक ने भुगतान किया पर आया नहीं — मेरी चेयर और बुकिंग का क्या होगा?\" सही स्पष्टीकरण क्या है?",
            {
              options: [
                "बुकिंग NO_SHOW के रूप में चिह्नित होती है और चेयर अन्य बुकिंग के लिए मुक्त हो जाती है",
                "बुकिंग हमेशा के लिए HOLD रहती है और चेयर स्थायी रूप से अवरुद्ध रहती है",
              ],
            }
          ),
        ],
        grading: { type: "SINGLE_CHOICE", correctOptionIndex: 0 },
      },
    ],
  },

  {
    moduleKey: MODULE_KEY.KYC_FINANCE_POLICY,
    title: [en("KYC, Finance, Ratings & Policies"), hi("केवाईसी, वित्त, रेटिंग व नीतियाँ")],
    content: [
      {
        contentType: "LESSON",
        translations: [
          en(
            "KYC outcomes and resubmission",
            "A KYC submission can be PENDING (under review), APPROVED, or REJECTED. A rejection always states a reason; the owner corrects the specific issue (usually a document) and resubmits — it is not a full restart. A Field Agent's role is to help the owner understand the rejection reason and prepare a correct resubmission, never to approve/override the decision themselves."
          ),
          hi(
            "केवाईसी परिणाम और पुनः सबमिशन",
            "केवाईसी सबमिशन PENDING (समीक्षा में), APPROVED, या REJECTED हो सकती है। अस्वीकृति में हमेशा कारण बताया जाता है; मालिक उस विशेष समस्या (आमतौर पर एक दस्तावेज़) को ठीक करके पुनः सबमिट करता है — यह पूरी तरह नई शुरुआत नहीं है। फ़ील्ड एजेंट की भूमिका है मालिक को अस्वीकृति कारण समझाना और सही पुनः सबमिशन तैयार करवाना, न कि स्वयं निर्णय स्वीकृत/बदलना।"
          ),
        ],
      },
      {
        contentType: "LESSON",
        translations: [
          en(
            "How owner earnings work",
            "Every COMPLETED booking credits the salon's wallet ledger for that booking's earned amount. The owner can see individual entries and running balance inside the Salon App's wallet/earnings section. Payouts and commission deductions follow ZEMISH's official published policy — a Field Agent explains this using only that published policy, never an estimate they invent."
          ),
          hi(
            "मालिक की कमाई कैसे काम करती है",
            "हर COMPLETED बुकिंग उस बुकिंग की कमाई राशि के लिए सैलून के वॉलेट लेजर में जमा होती है। मालिक सैलून ऐप के वॉलेट/कमाई सेक्शन में अलग-अलग एंट्री व चालू बैलेंस देख सकता है। भुगतान व कमीशन कटौती ज़ेमिश की आधिकारिक प्रकाशित नीति के अनुसार होती है — फ़ील्ड एजेंट इसे केवल उसी प्रकाशित नीति से समझाए, कभी अपने अनुमान से नहीं।"
          ),
        ],
      },
      {
        contentType: "PRACTICAL_SCENARIO",
        translations: [
          en(
            "Explain a KYC rejection",
            "An owner's KYC was REJECTED for a blurry PAN photo. What should the Field Agent do?",
            {
              options: [
                "Explain the specific reason, help the owner take a clear new photo, and guide them to resubmit that document",
                "Tell the owner to wait — it will get approved automatically eventually",
              ],
            }
          ),
          hi(
            "केवाईसी अस्वीकृति समझाएँ",
            "मालिक की केवाईसी धुंधली पैन फोटो के कारण REJECTED हुई। फ़ील्ड एजेंट को क्या करना चाहिए?",
            {
              options: [
                "विशेष कारण समझाएँ, मालिक को साफ़ नई फोटो लेने में मदद करें, और उस दस्तावेज़ को पुनः सबमिट करने में मार्गदर्शन करें",
                "मालिक से कहें इंतज़ार करे — यह अपने आप स्वीकृत हो जाएगी",
              ],
            }
          ),
        ],
        grading: { type: "SINGLE_CHOICE", correctOptionIndex: 0 },
      },
      {
        contentType: "PRACTICAL_SCENARIO",
        translations: [
          en(
            "Explain owner earnings",
            "An owner asks how they can verify what ZEMISH owes them. What is the correct answer?",
            {
              options: [
                "Open the wallet/earnings section in the Salon App — every COMPLETED booking's credited amount is listed there",
                "There is no way to see this until payout day",
              ],
            }
          ),
          hi(
            "मालिक की कमाई समझाएँ",
            "मालिक पूछता है कि वह कैसे जाँच सकता है ज़ेमिश उस पर क्या बकाया है। सही उत्तर क्या है?",
            {
              options: [
                "सैलून ऐप में वॉलेट/कमाई सेक्शन खोलें — हर COMPLETED बुकिंग की जमा राशि वहाँ सूचीबद्ध है",
                "भुगतान दिन तक इसे देखने का कोई तरीका नहीं है",
              ],
            }
          ),
        ],
        grading: { type: "SINGLE_CHOICE", correctOptionIndex: 0 },
      },
    ],
  },

  {
    moduleKey: MODULE_KEY.TROUBLESHOOTING_SUPPORT,
    title: [en("Troubleshooting & Support"), hi("समस्या निवारण व सहायता")],
    content: [
      {
        contentType: "LESSON",
        translations: [
          en(
            "Solve vs. escalate",
            "Field Agents can solve: confusion about app navigation, missing/incorrect schedule or service setup, basic KYC document guidance, and general 'how does this work' questions. Field Agents must escalate to ZEMISH Support: any payment/financial dispute, any request to override commission or policy, suspected fraud, and anything requiring account-level system changes."
          ),
          hi(
            "समाधान करें बनाम आगे भेजें",
            "फ़ील्ड एजेंट यह हल कर सकते हैं: ऐप नेविगेशन को लेकर भ्रम, गुम/गलत शेड्यूल या सेवा सेटअप, बुनियादी केवाईसी दस्तावेज़ मार्गदर्शन, और सामान्य 'यह कैसे काम करता है' प्रश्न। फ़ील्ड एजेंट को ज़ेमिश सपोर्ट के पास भेजना चाहिए: कोई भी भुगतान/वित्तीय विवाद, कमीशन या नीति बदलने का कोई अनुरोध, संदिग्ध धोखाधड़ी, और खाता-स्तर की सिस्टम बदलाव की ज़रूरत वाली कोई भी बात।"
          ),
        ],
      },
      {
        contentType: "PRACTICAL_SCENARIO",
        translations: [
          en(
            "Decide: solve or escalate?",
            "An owner says a customer's payment shows as deducted on their bank statement but not credited to the salon wallet. What should you do?",
            {
              options: [
                "Escalate to ZEMISH Support — this is a financial/payment dispute outside Field Agent authority",
                "Manually add the amount to the owner's wallet yourself to resolve it quickly",
              ],
            }
          ),
          hi(
            "निर्णय: समाधान करें या आगे भेजें?",
            "मालिक कहता है कि ग्राहक का भुगतान बैंक स्टेटमेंट में कटा दिख रहा है पर सैलून वॉलेट में जमा नहीं हुआ। आपको क्या करना चाहिए?",
            {
              options: [
                "ज़ेमिश सपोर्ट के पास भेजें — यह फ़ील्ड एजेंट के अधिकार से बाहर का भुगतान/वित्तीय विवाद है",
                "जल्दी हल करने के लिए खुद मालिक के वॉलेट में राशि जोड़ दें",
              ],
            }
          ),
        ],
        grading: { type: "SINGLE_CHOICE", correctOptionIndex: 0 },
      },
    ],
  },

  {
    moduleKey: MODULE_KEY.FIELD_VISIT_EDUCATION,
    title: [en("Field Visit & Owner Education"), hi("फ़ील्ड विज़िट व मालिक शिक्षा")],
    content: [
      {
        contentType: "LESSON",
        translations: [
          en(
            "Before, during, and after a visit",
            "Before: review the salon's current status and prepare what's needed. During: introduce ZEMISH, demonstrate the app, complete registration/onboarding/configuration, and actively teach — don't just do it for them. Before leaving: verify the configuration is correct, verify the owner can use the app themselves, and verify the salon is actually ready to activate. After: follow up and provide first-line support as questions come up."
          ),
          hi(
            "विज़िट से पहले, दौरान और बाद में",
            "पहले: सैलून की वर्तमान स्थिति की समीक्षा करें और ज़रूरी चीज़ें तैयार करें। दौरान: ज़ेमिश का परिचय दें, ऐप प्रदर्शित करें, पंजीकरण/ऑनबोर्डिंग/कॉन्फ़िगरेशन पूरा करें, और सक्रिय रूप से सिखाएँ — केवल खुद न कर दें। जाने से पहले: कॉन्फ़िगरेशन सही है यह सुनिश्चित करें, मालिक खुद ऐप उपयोग कर सकता है यह सुनिश्चित करें, और सैलून वाकई सक्रिय होने के लिए तैयार है यह सुनिश्चित करें। बाद में: फॉलो-अप करें और प्रश्न आने पर प्रथम-स्तरीय सहायता दें।"
          ),
        ],
      },
      {
        contentType: "KNOWLEDGE_CHECK",
        translations: [
          en("Check your understanding", "What should you verify BEFORE leaving a successful onboarding visit?", {
            options: [
              "That the owner can operate the app themselves, not just that you configured it",
              "Only that the paperwork is signed",
            ],
          }),
          hi("अपनी समझ जाँचें", "सफल ऑनबोर्डिंग विज़िट छोड़ने से पहले आपको क्या सुनिश्चित करना चाहिए?", {
            options: ["कि मालिक खुद ऐप चला सकता है, सिर्फ़ यह नहीं कि आपने कॉन्फ़िगर किया", "सिर्फ़ यह कि कागज़ी कार्रवाई पर हस्ताक्षर हुए"],
          }),
        ],
        grading: { type: "SINGLE_CHOICE", correctOptionIndex: 0 },
      },
    ],
  },

  {
    moduleKey: MODULE_KEY.COMPLIANCE_CONDUCT,
    title: [en("Compliance, Fraud & Field Agent Conduct"), hi("अनुपालन, धोखाधड़ी व फ़ील्ड एजेंट आचरण")],
    content: [
      {
        contentType: "LESSON",
        translations: [
          en(
            "Non-negotiable rules",
            "Never onboard a fake or non-existent salon. Never duplicate or manipulate an onboarding to inflate numbers. Never onboard your own family/friends to manipulate incentives. Never misuse an owner's OTP, password, or credentials — you assist, you don't act as them. Never fabricate information or manipulate commission figures. Never make a financial commitment ZEMISH hasn't authorized. Keep every owner's data confidential. Report anything that looks like fraud immediately through the correct escalation path."
          ),
          hi(
            "अटल नियम",
            "कभी भी नकली या गैर-मौजूद सैलून ऑनबोर्ड न करें। संख्या बढ़ाने के लिए कभी भी ऑनबोर्डिंग की नकल या हेरफेर न करें। प्रोत्साहन में हेरफेर के लिए कभी अपने परिवार/दोस्तों को ऑनबोर्ड न करें। मालिक की ओटीपी, पासवर्ड, या क्रेडेंशियल का कभी दुरुपयोग न करें — आप सहायता करते हैं, उनकी जगह कार्य नहीं करते। कभी जानकारी न गढ़ें या कमीशन आंकड़ों में हेरफेर न करें। ज़ेमिश द्वारा अधिकृत न किया गया कोई भी वित्तीय वादा न करें। हर मालिक का डेटा गोपनीय रखें। धोखाधड़ी जैसी किसी भी बात की तुरंत सही एस्केलेशन पथ से रिपोर्ट करें।"
          ),
        ],
      },
      {
        contentType: "KNOWLEDGE_CHECK",
        translations: [
          en("Check your understanding", "Is it acceptable to onboard your own relative's salon to boost your numbers?", {
            options: ["No — this is a fraud/conduct violation regardless of intent", "Yes, as long as the salon is real"],
          }),
          hi("अपनी समझ जाँचें", "क्या अपने रिश्तेदार का सैलून अपनी संख्या बढ़ाने के लिए ऑनबोर्ड करना स्वीकार्य है?", {
            options: ["नहीं — यह इरादे की परवाह किए बिना धोखाधड़ी/आचरण उल्लंघन है", "हाँ, जब तक सैलून असली है"],
          }),
        ],
        grading: { type: "SINGLE_CHOICE", correctOptionIndex: 0 },
      },
    ],
  },
];

// ─── RUN ────────────────────────────────────────────────────────

const run = async () => {
  await connectDB();

  const admin = await getOrCreateSeedAdmin();
  const adminId = admin._id;

  const version = await createDraftVersion({ adminId, notes: "FA-3.3.1 v1 curriculum — seeded" });
  console.log(`📘 Draft training version created: v${version.versionNumber} (${version._id})`);

  let sampleMediaContentId = null;

  for (const moduleDef of CURRICULUM) {
    const trainingModule = await addModule({
      versionId: version._id,
      moduleKey: moduleDef.moduleKey,
      translations: moduleDef.title,
      adminId,
    });
    console.log(`  📦 Module ${moduleDef.moduleKey} created`);

    for (const contentDef of moduleDef.content) {
      const content = await addContent({
        moduleId: trainingModule._id,
        contentType: contentDef.contentType,
        translations: contentDef.translations,
        grading: contentDef.grading ?? null,
        helpEligible: contentDef.helpEligible ?? contentDef.contentType === "LESSON",
        adminId,
      });

      // Media MUST be attached while the version is still DRAFT —
      // once published, TrainingContent is immutable (by design) and
      // this exact call would correctly be refused with 409. Attach
      // to the very first LESSON authored, purely so this v1 fixture
      // proves the real Cloudinary type:"authenticated" upload +
      // signed-delivery path end to end.
      if (!sampleMediaContentId && contentDef.contentType === "LESSON") {
        const { publicId, resourceType } = await uploadTrainingMedia({
          buffer: SAMPLE_MEDIA_PNG,
          mimetype: "image/png",
          contentId: content._id,
        });
        await updateContent({ contentId: content._id, patch: { media: { publicId, resourceType } }, adminId });
        sampleMediaContentId = content._id;
        console.log(`     🖼️  Sample media attached to content ${content._id}`);
      }
    }
    console.log(`     ✅ ${moduleDef.content.length} content item(s) added`);
  }

  const published = await publishVersion({ versionId: version._id, adminId });
  console.log(`🚀 Training version v${published.versionNumber} PUBLISHED`);
  console.log(`   Sample media content id: ${sampleMediaContentId}`);

  await mongoose.connection.close();
  process.exit(0);
};

// Guarded so scripts/verifyFieldAgentTraining.js can `import { CURRICULUM }`
// from this file (reusing the exact authored rubrics as its test
// oracle) without re-running the seeder as a side effect of import.
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  run().catch(async (err) => {
    console.error("❌ Seed failed:", err.message);
    console.error(err.stack);
    await mongoose.connection.close();
    process.exit(1);
  });
}

export { CURRICULUM };
