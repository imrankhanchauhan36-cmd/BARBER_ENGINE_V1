import {
  useState,
} from "react";

const usePagination = () => {

  const [page, setPage] =
    useState(1);

  const [hasMore, setHasMore] =
    useState(true);

  const nextPage = () => {
    setPage(prev => prev + 1);
  };

  const resetPagination = () => {

    setPage(1);

    setHasMore(true);
  };

  return {
    page,
    setPage,

    hasMore,
    setHasMore,

    nextPage,
    resetPagination,
  };
};

export default usePagination;