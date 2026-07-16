// @vitest-environment node
import { describe, expect, it, vi } from "vitest"
import { cloneTemplateFieldsAndConditions } from "@/lib/uploads/template-upload"

describe("template-version field and condition cloning", () => {
  it("preserves field geometry and remaps field-owned conditions by fieldKey", async () => {
    const oldField = {
      id: "old-field", organizationId: "org", fieldKey: "client_name", name: "Client Name", fieldType: "text",
      pageNumber: 1, posX: 10, posY: 20, width: 100, height: 30, isRequired: true, sortOrder: 0,
    }
    const newField = { ...oldField, id: "new-field", documentTemplateId: "new-template" }
    const fieldFindMany = vi.fn()
      .mockResolvedValueOnce([oldField])
      .mockResolvedValueOnce([newField])
    const fieldCreateMany = vi.fn().mockResolvedValue({ count: 1 })
    const groupFindMany = vi.fn().mockResolvedValue([{
      id: "old-root",
      documentTemplateFieldId: "old-field",
      purpose: "FIELD_VISIBILITY",
      logicOperator: "AND",
      conditions: [{
        sourceType: "CLIENT_IS_MINOR", sourceFieldKey: null, operator: "IN",
        comparisonValue: ["yes", "unknown"], sortOrder: 0,
      }],
      childGroups: [],
    }])
    const groupCreate = vi.fn().mockResolvedValue({ id: "new-root" })
    const conditionCreateMany = vi.fn().mockResolvedValue({ count: 1 })
    const tx = {
      documentTemplateField: { findMany: fieldFindMany, createMany: fieldCreateMany },
      templateConditionGroup: { findMany: groupFindMany, create: groupCreate },
      templateCondition: { createMany: conditionCreateMany },
    }
    await cloneTemplateFieldsAndConditions(tx as never, "old-template", "new-template", "org")
    expect(fieldCreateMany).toHaveBeenCalledWith({ data: [expect.objectContaining({
      documentTemplateId: "new-template", fieldKey: "client_name", posX: 10, posY: 20, width: 100, height: 30,
    })] })
    expect(groupCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ documentTemplateFieldId: "new-field" }) })
    expect(conditionCreateMany).toHaveBeenCalledWith({ data: [expect.objectContaining({
      groupId: "new-root", comparisonValue: ["yes", "unknown"],
    })] })
  })

  it("fails linkage if a prior field cannot be remapped", async () => {
    const tx = {
      documentTemplateField: {
        findMany: vi.fn().mockResolvedValueOnce([{ id: "old", organizationId: "org", fieldKey: "missing" }]).mockResolvedValueOnce([]),
        createMany: vi.fn(),
      },
      templateConditionGroup: {
        findMany: vi.fn().mockResolvedValue([{ documentTemplateFieldId: "old", conditions: [], childGroups: [] }]),
        create: vi.fn(),
      },
      templateCondition: { createMany: vi.fn() },
    }
    await expect(cloneTemplateFieldsAndConditions(tx as never, "old", "new", "org")).rejects.toThrow(/changed during version creation/i)
  })

  it("does nothing when the prior template has no fields", async () => {
    const createMany = vi.fn()
    const tx = {
      documentTemplateField: { findMany: vi.fn().mockResolvedValue([]), createMany },
      templateConditionGroup: { findMany: vi.fn(), create: vi.fn() },
      templateCondition: { createMany: vi.fn() },
    }
    await cloneTemplateFieldsAndConditions(tx as never, "old", "new", "org")
    expect(createMany).not.toHaveBeenCalled()
    expect(tx.templateConditionGroup.findMany).not.toHaveBeenCalled()
  })

  it("copies fields successfully when there are no field-owned conditions", async () => {
    const field = {
      id: "old-field", organizationId: "org", fieldKey: "key", name: "Name", fieldType: "text",
      pageNumber: 2, posX: 1, posY: 2, width: 3, height: 4, isRequired: false, sortOrder: 5,
    }
    const tx = {
      documentTemplateField: {
        findMany: vi.fn().mockResolvedValueOnce([field]).mockResolvedValueOnce([{ ...field, id: "new-field" }]),
        createMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      templateConditionGroup: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn() },
      templateCondition: { createMany: vi.fn() },
    }
    await cloneTemplateFieldsAndConditions(tx as never, "old", "new", "org")
    expect(tx.documentTemplateField.createMany).toHaveBeenCalledOnce()
    expect(tx.templateConditionGroup.create).not.toHaveBeenCalled()
  })

  it("reattaches nested child groups beneath the new root", async () => {
    const field = {
      id: "old-field", organizationId: "org", fieldKey: "key", name: "Name", fieldType: "text",
      pageNumber: 1, posX: 1, posY: 1, width: 1, height: 1, isRequired: false, sortOrder: 0,
    }
    const groupCreate = vi.fn()
      .mockResolvedValueOnce({ id: "new-root" })
      .mockResolvedValueOnce({ id: "new-child" })
    const conditionCreate = vi.fn().mockResolvedValue({ count: 1 })
    const tx = {
      documentTemplateField: {
        findMany: vi.fn().mockResolvedValueOnce([field]).mockResolvedValueOnce([{ ...field, id: "new-field" }]),
        createMany: vi.fn(),
      },
      templateConditionGroup: {
        findMany: vi.fn().mockResolvedValue([{
          documentTemplateFieldId: "old-field", purpose: "FIELD_VISIBILITY", logicOperator: "AND", conditions: [],
          childGroups: [{
            purpose: "FIELD_VISIBILITY", logicOperator: "OR",
            conditions: [{ sourceType: "CLIENT_FIELD", sourceFieldKey: "status", operator: "EQUALS", comparisonValue: "active", sortOrder: 0 }],
          }],
        }]),
        create: groupCreate,
      },
      templateCondition: { createMany: conditionCreate },
    }
    await cloneTemplateFieldsAndConditions(tx as never, "old", "new", "org")
    expect(groupCreate).toHaveBeenNthCalledWith(2, { data: expect.objectContaining({ parentGroupId: "new-root", logicOperator: "OR" }) })
    expect(conditionCreate).toHaveBeenCalledWith({ data: [expect.objectContaining({ groupId: "new-child", sourceFieldKey: "status" })] })
  })

  it("never mutates prior fields or condition groups", async () => {
    const tx = {
      documentTemplateField: { findMany: vi.fn().mockResolvedValue([]), createMany: vi.fn() },
      templateConditionGroup: { findMany: vi.fn(), create: vi.fn() },
      templateCondition: { createMany: vi.fn() },
    }
    await cloneTemplateFieldsAndConditions(tx as never, "old", "new", "org")
    expect(tx.documentTemplateField).not.toHaveProperty("update")
    expect(tx.documentTemplateField).not.toHaveProperty("delete")
    expect(tx.templateConditionGroup).not.toHaveProperty("update")
    expect(tx.templateConditionGroup).not.toHaveProperty("delete")
  })

  it("scopes the condition query to root groups owned by prior fields", async () => {
    const field = {
      id: "old-field", organizationId: "org", fieldKey: "key", name: "Name", fieldType: "text",
      pageNumber: 1, posX: 1, posY: 1, width: 1, height: 1, isRequired: false, sortOrder: 0,
    }
    const findGroups = vi.fn().mockResolvedValue([])
    const tx = {
      documentTemplateField: {
        findMany: vi.fn().mockResolvedValueOnce([field]).mockResolvedValueOnce([{ ...field, id: "new-field" }]),
        createMany: vi.fn(),
      },
      templateConditionGroup: { findMany: findGroups, create: vi.fn() },
      templateCondition: { createMany: vi.fn() },
    }
    await cloneTemplateFieldsAndConditions(tx as never, "old", "new", "org")
    expect(findGroups).toHaveBeenCalledWith({
      where: { documentTemplateFieldId: { in: ["old-field"] }, parentGroupId: null },
      include: { conditions: true, childGroups: { include: { conditions: true } } },
    })
  })
})
