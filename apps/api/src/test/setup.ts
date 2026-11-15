import { setResendPacing } from "../email/send";

// Tests stub Resend, so there's no rate limit to keep to.
setResendPacing(0);
