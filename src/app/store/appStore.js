import React, {
  createContext,
  useContext,
  useMemo,
  useState,
} from "react";

const AppStoreContext =
  createContext(null);

export const AppStoreProvider = ({
  children,
}) => {

  //////////////////////////////////////////////////////
  // APP STATE
  //////////////////////////////////////////////////////

  const [isAppReady, setIsAppReady] =
    useState(false);

  const [isOnline, setIsOnline] =
    useState(true);

  const [loading, setLoading] =
    useState(false);

  //////////////////////////////////////////////////////
  // MEMOIZED VALUE
  //////////////////////////////////////////////////////

  const value = useMemo(
    () => ({
      isAppReady,
      setIsAppReady,

      isOnline,
      setIsOnline,

      loading,
      setLoading,
    }),

    [
      isAppReady,
      isOnline,
      loading,
    ]
  );

  return (
    <AppStoreContext.Provider
      value={value}
    >
      {children}
    </AppStoreContext.Provider>
  );
};

//////////////////////////////////////////////////////
// CUSTOM HOOK
//////////////////////////////////////////////////////

export const useAppStore = () => {

  const context =
    useContext(AppStoreContext);

  if (!context) {

    throw new Error(
      "useAppStore must be used inside AppStoreProvider"
    );
  }

  return context;
};