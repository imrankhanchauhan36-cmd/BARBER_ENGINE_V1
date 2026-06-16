import { useMemo } from "react";

import {
  useBooking,
} from "../store/BookingContext";

import {
  addService,
  removeService,
  calculateTotalDuration,
  calculateTotalPrice,
} from "../utils/serviceUtils";

const useServiceSelection =
  () => {

    const {
      selectedServices,
      setSelectedServices,
    } = useBooking();

    ////////////////////////////////////////////////////
    // TOGGLE SERVICE
    ////////////////////////////////////////////////////

    const toggleService =
      (service) => {

        const exists =
          selectedServices.some(
            item =>
              item._id ===
              service._id
          );

        if (exists) {

          const updated =
            removeService({
              services:
                selectedServices,

              serviceId:
                service._id,
            });

          setSelectedServices(
            updated
          );

          return;
        }

        const updated =
          addService({
            services:
              selectedServices,

            service,
          });

        setSelectedServices(
          updated
        );
      };

    ////////////////////////////////////////////////////
    // TOTALS
    ////////////////////////////////////////////////////

    const totalDuration =
      useMemo(
        () =>
          calculateTotalDuration(
            selectedServices
          ),

        [selectedServices]
      );

    const totalPrice =
      useMemo(
        () =>
          calculateTotalPrice(
            selectedServices
          ),

        [selectedServices]
      );

    return {

      selectedServices,

      toggleService,

      totalDuration,

      totalPrice,
    };
};

export default useServiceSelection;