import { describe, expect, it } from "vitest"
import { FORM_STAGES, STAGE_DEFINITIONS, templateNameFromSourceFile } from "@/lib/content/forms-245d"

describe("MN 245D form-set taxonomy", () => {
  it("defines the approved 44-form baseline across the four workflow stages", () => {
    expect(FORM_STAGES).toEqual(["intake", "45day", "semiannual", "annual"])
    const counts = Object.fromEntries(STAGE_DEFINITIONS.map((stage) => [stage.directory, stage.expectedFormCount]))
    expect(counts).toEqual({ intake: 14, "45day": 4, semiannual: 6, annual: 20 })
    expect(STAGE_DEFINITIONS.reduce((sum, stage) => sum + stage.expectedFormCount, 0)).toBe(44)
  })

  it("uses the existing packet-type taxonomy including the 45_day type", () => {
    const packetTypes = STAGE_DEFINITIONS.map((stage) => stage.packetType)
    expect(packetTypes).toEqual(["initial_intake", "45_day", "semiannual_review", "annual_review"])
  })

  it("derives stage-qualified template names from source filenames", () => {
    const [intake, fortyFive, semiannual, annual] = STAGE_DEFINITIONS
    expect(templateNameFromSourceFile("INTAKE- DPF-004--Admission Form and Data Sheet.pdf", intake))
      .toBe("Intake — DPF-004 Admission Form and Data Sheet")
    expect(templateNameFromSourceFile("45 Day Forms-DPF-034--Single Dated Signature Page.pdf", fortyFive))
      .toBe("45-Day — DPF-034 Single Dated Signature Page")
    expect(templateNameFromSourceFile("SEMI ANNUAL-DPF-012--Designated Coordinator Review.pdf", semiannual))
      .toBe("Semiannual — DPF-012 Designated Coordinator Review")
    expect(templateNameFromSourceFile("ANNUAL-DPF-002--Rights Restrictions .pdf", annual))
      .toBe("Annual — DPF-002 Rights Restrictions")
    expect(templateNameFromSourceFile("ANNUAL- 245D Individual Abuse Prevention Plan Form.pdf", annual))
      .toBe("Annual — 245D Individual Abuse Prevention Plan Form")
    expect(templateNameFromSourceFile("INTAKE- DHS 7176 Residency agreement template.pdf", intake))
      .toBe("Intake — DHS 7176 Residency agreement template")
  })
})
