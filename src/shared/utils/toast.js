import Toast from "react-native-toast-message";

const DEFAULT_CONFIG = {
  position: "top",
  visibilityTime: 3000,
  autoHide: true,
  topOffset: 60,
};

export const showSuccess = (
  title,
  message = ""
) => {
  Toast.show({
    type: "success",
    text1: title || "Success",
    text2: message,
    ...DEFAULT_CONFIG,
  });
};

export const showError = (
  title,
  message = ""
) => {
  Toast.show({
    type: "error",
    text1: title || "Error",
    text2: message,
    ...DEFAULT_CONFIG,
  });
};

export const showInfo = (
  title,
  message = ""
) => {
  Toast.show({
    type: "info",
    text1: title || "Info",
    text2: message,
    ...DEFAULT_CONFIG,
  });
};

export const showWarning = (
  title,
  message = ""
) => {
  Toast.show({
    type: "error",
    text1: title || "Warning",
    text2: message,
    ...DEFAULT_CONFIG,
  });
};