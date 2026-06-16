//////////////////////////////////////////////////////
// ADD SERVICE
//////////////////////////////////////////////////////

export const addService = ({
  services = [],

  service,
}) => {

  const exists =
    services.some(
      item =>
        item._id ===
        service._id
    );

  if (exists) {
    return services;
  }

  return [
    ...services,
    service,
  ];
};

//////////////////////////////////////////////////////
// REMOVE SERVICE
//////////////////////////////////////////////////////

export const removeService = ({
  services = [],

  serviceId,
}) => {

  return services.filter(
    service =>
      service._id !==
      serviceId
  );
};

//////////////////////////////////////////////////////
// TOTAL DURATION
//////////////////////////////////////////////////////

export const calculateTotalDuration =
  (
    services = []
  ) => {

    return services.reduce(

      (sum, service) =>
        sum +
        (
          parseInt(service.duration) || 0
        ),

      0
    );
};

//////////////////////////////////////////////////////
// TOTAL PRICE
//////////////////////////////////////////////////////

export const calculateTotalPrice =
  (
    services = []
  ) => {

    return services.reduce(

      (sum, service) =>
        sum +
        (
          service.price || 0
        ),

      0
    );
};