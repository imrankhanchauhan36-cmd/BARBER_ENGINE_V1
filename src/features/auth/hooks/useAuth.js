import { useContext } from "react";
import { AuthContext } from "../store/AuthContext";

export const useAuth = () => {
  return useContext(AuthContext);
};