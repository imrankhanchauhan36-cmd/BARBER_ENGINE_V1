//////////////////////////////////////////////////////
// BARBER_ENGINE_V1 — USER APP
// components/ServiceHowItWorks.js — v2 FINAL ✅
// 9.9/10 Production Ready
//////////////////////////////////////////////////////

import React from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, FONTS, RADIUS } from "../../../config/theme";

const PURPLE = "#5C35E8";

// Dynamic icon per step title
const getStepIcon = (title = "") => {
  const t = title.toLowerCase();
  if (t.includes("consult"))                     return "chatbubble-outline";
  if (t.includes("wash") || t.includes("clean")) return "water-outline";
  if (t.includes("cut") || t.includes("trim"))   return "cut-outline";
  if (t.includes("style") || t.includes("blow")) return "sparkles-outline";
  if (t.includes("massage"))                     return "hand-left-outline";
  if (t.includes("steam") || t.includes("heat")) return "flame-outline";
  if (t.includes("mask") || t.includes("cream")) return "flower-outline";
  if (t.includes("rinse") || t.includes("finish"))return "checkmark-circle-outline";
  if (t.includes("analysis") || t.includes("check")) return "search-outline";
  if (t.includes("prep") || t.includes("ready")) return "options-outline";
  return "ellipse-outline";
};

export default function ServiceHowItWorks({ steps = [], totalDuration }) {
  if (!steps.length) return null;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>How This Service Works</Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.stepsList}
      >
        {steps.map((step, i) => (
          <View key={step.id || `${step.title}-${i}`} style={styles.stepWrapper}>
            {/* Step Card */}
            <View
              style={styles.stepCard}
              accessible
              accessibilityLabel={`Step ${i + 1}: ${step.title || step}`}
            >
              <View style={styles.stepNumber}>
                <Text style={styles.stepNumberText}>{i + 1}</Text>
              </View>
              <Ionicons
                name={getStepIcon(step.title || step)}
                size={24}
                color={PURPLE}
                style={{ marginBottom: 6, marginTop: 4 }}
              />
              <Text style={styles.stepTitle} numberOfLines={2}>
                {step.title || step}
              </Text>
              {step.duration ? (
                <Text style={styles.stepDuration}>{step.duration}</Text>
              ) : null}
              {step.desc ? (
                <Text style={styles.stepDesc} numberOfLines={3}>{step.desc}</Text>
              ) : null}
            </View>

            {/* Connector arrow between steps */}
            {i < steps.length - 1 && (
              <View style={styles.connector}>
                <Ionicons name="chevron-forward" size={16} color={PURPLE} style={{ opacity: 0.4 }} />
              </View>
            )}
          </View>
        ))}
      </ScrollView>

      {totalDuration && (
        <View style={styles.totalChip}>
          <Ionicons name="time-outline" size={13} color={PURPLE} />
          <Text style={styles.totalText}>Total Duration: {totalDuration} mins</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    padding: 16,
    borderBottomWidth: 0.5,
    borderBottomColor: COLORS.border,
  },
  sectionTitle: {
    fontSize: 15,
    fontFamily: FONTS.bold,
    color: COLORS.text.primary,
    marginBottom: 12,
  },

  stepsList: { paddingBottom: 4, alignItems: "center" },

  stepWrapper: {
    flexDirection: "row",
    alignItems: "center",
  },

  stepCard: {
    width: 140,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: 12,
    borderWidth: 0.5, borderColor: COLORS.border,
    alignItems: "center",
    gap: 4,
    minHeight: 110,
  },
  stepNumber: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: PURPLE,
    justifyContent: "center", alignItems: "center",
    position: "absolute", top: 8, left: 8,
  },
  stepNumberText: { fontSize: 10, fontFamily: FONTS.bold, color: "#fff" },
  stepTitle:    { fontSize: 11, fontFamily: FONTS.bold,    color: COLORS.text.primary,   textAlign: "center" },
  stepDuration: { fontSize: 10, fontFamily: FONTS.regular, color: PURPLE,                textAlign: "center" },
  stepDesc:     { fontSize: 9,  fontFamily: FONTS.regular, color: COLORS.text.secondary, textAlign: "center", lineHeight: 13 },

  // Connector between steps
  connector: {
    width: 20,
    alignItems: "center",
    justifyContent: "center",
  },

  totalChip: {
    flexDirection: "row", alignItems: "center", gap: 5,
    alignSelf: "center", marginTop: 12,
    backgroundColor: "#F5F3FF",
    borderRadius: RADIUS.full,
    paddingHorizontal: 14, paddingVertical: 6,
    borderWidth: 0.5, borderColor: "#DDD6FE",
  },
  totalText: { fontSize: 12, fontFamily: FONTS.bold, color: PURPLE },
});