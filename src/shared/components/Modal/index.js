import React from "react";

import {
  Modal as RNModal,
  View,
  Text,
} from "react-native";

import Button from "../Button";

import styles from "./styles";

const Modal = ({
  visible = false,

  title = "",

  message = "",

  onClose,

  onConfirm,

  confirmText = "Confirm",

  cancelText = "Cancel",
}) => {

  return (
    <RNModal
      visible={visible}
      transparent
      animationType="fade"
    >
      <View style={styles.overlay}>
        <View style={styles.container}>
          <Text style={styles.title}>
            {title}
          </Text>

          {message ? (
            <Text style={styles.message}>
              {message}
            </Text>
          ) : null}

          <View style={styles.actions}>
            <Button
              title={cancelText}
              onPress={onClose}
              style={styles.cancelButton}
            />

            <Button
              title={confirmText}
              onPress={onConfirm}
              style={styles.confirmButton}
            />
          </View>
        </View>
      </View>
    </RNModal>
  );
};

export default Modal;