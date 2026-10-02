import { router } from "./core.js";
import { authRouter } from "./auth-router.js";
import { venueRouter } from "./venue-router.js";
import { customerBookingRouter } from "./customer-booking-router.js";
import { adminBookingRouter } from "./admin-booking-router.js";

export const appRouter = router({
  auth: authRouter,
  venue: venueRouter,
  booking: customerBookingRouter,
  admin: adminBookingRouter,
});

export type AppRouter = typeof appRouter;
