import React from "react";

import {
  View,
  Text,
  TouchableOpacity,
} from "react-native";

import { Ionicons } from "@expo/vector-icons";

import { useNavigation } from "@react-navigation/native";

import styles from "./styles";

import { COLORS } from "../../../constants/colors";

const Header = ({
  title = "",

  showBack = true,

  rightIcon = "",

  onRightPress,
}) => {

  const navigation =
    useNavigation();

  return (
    <View style={styles.container}>
      <View style={styles.left}>
        {showBack ? (
          <TouchableOpacity
            onPress={() =>
              navigation.goBack()
            }
          >
            <Ionicons
              name="arrow-back"
              size={24}
              color={COLORS.text}
            />
          </TouchableOpacity>
        ) : null}
      </View>

      <Text style={styles.title}>
        {title}
      </Text>

      <View style={styles.right}>
        {rightIcon ? (
          <TouchableOpacity
            onPress={onRightPress}
          >
            <Ionicons
              name={rightIcon}
              size={22}
              color={COLORS.text}
            />
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
};

export default Header;