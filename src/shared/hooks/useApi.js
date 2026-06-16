import {
  useCallback,
  useState,
} from "react";

const useApi = (
  apiFunction
) => {

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState(null);

  const request =
    useCallback(

      async (...args) => {

        try {

          setLoading(true);

          setError(null);

          const response =
            await apiFunction(
              ...args
            );

          return response;

        } catch (err) {

          setError(
            err?.message ||
            "Something went wrong"
          );

          throw err;

        } finally {

          setLoading(false);
        }
      },

      [apiFunction]
    );

  return {
    loading,
    error,
    request,
  };
};

export default useApi;