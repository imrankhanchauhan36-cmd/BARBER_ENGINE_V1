import {
  useCallback,
} from "react";

import {
  isSlotRangeAvailable,

  findNearestAvailableSlot,
} from "../utils/slotUtils";

const useSlotValidation = () => {

  //////////////////////////////////////////////////////
  // VALIDATE SLOT
  //////////////////////////////////////////////////////

  const validateSlot =
    useCallback(

      ({
        slots = [],

        selectedTime,

        duration,
      }) => {

        const available =
          isSlotRangeAvailable({
            slots,

            startTime:
              selectedTime,

            duration,
          });

        //////////////////////////////////////////////////
        // SLOT AVAILABLE
        //////////////////////////////////////////////////

        if (available) {

          return {
            valid: true,

            adjusted: false,

            time:
              selectedTime,
          };
        }

        //////////////////////////////////////////////////
        // TRY SMART ADJUSTMENT
        //////////////////////////////////////////////////

        const nearest =
          findNearestAvailableSlot({
            slots,

            targetTime:
              selectedTime,

            duration,
          });

        if (nearest.found) {

          return {
            valid: true,

            adjusted: true,

            time:
              nearest.adjustedTime,

            adjustment:
              nearest.adjustment,
          };
        }

        //////////////////////////////////////////////////
        // NO SLOT FOUND
        //////////////////////////////////////////////////

        return {
          valid: false,
        };
      },

      []
    );

  return {
    validateSlot,
  };
};

export default useSlotValidation;