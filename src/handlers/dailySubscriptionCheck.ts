import { Bool, OpenAPIRoute } from "chanfana";
import { AppContext } from "../types";
import { GeneratePdf } from "./generatePdf";

export class DailySubscriptionCheck extends OpenAPIRoute {
  schema = {
    tags: ["Subscription"],
    summary: "Subscription Check",
  };

  async handle(c: AppContext) {
    try {
      const pdfHandler = new GeneratePdf();
      const response = await pdfHandler.handle(c);

      return c.json({
        success: true,
        result: "Called GeneratePdf internally",
        innerResult: await response.json(), // read JSON from the returned Response
      });
    } catch (err) {
      console.error("Error:", err);
      return c.json({ success: false, result: (err as Error).message }, 500);
    }
  }
}
