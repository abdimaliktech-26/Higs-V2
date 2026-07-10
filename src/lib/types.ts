export interface ClientFormData {
  firstName: string
  lastName: string
  dateOfBirth?: string
  email?: string
  phone?: string
  address?: string
  city?: string
  state?: string
  zipCode?: string
  mcadId?: string
  gender?: string
  preferredLanguage?: string
  fundingSource?: string
  status: string
  notes?: string
}

export interface ClientWithRelations {
  id: string
  organizationId: string
  firstName: string
  lastName: string
  dateOfBirth: Date | null
  email: string | null
  phone: string | null
  address: string | null
  city: string | null
  state: string | null
  zipCode: string | null
  mcadId: string | null
  ssn: string | null
  gender: string | null
  preferredLanguage: string | null
  status: string
  program: string | null
  fundingSource: string | null
  notes: string | null
  archivedAt: Date | null
  archivedReason: string | null
  createdAt: Date
  updatedAt: Date
  enrollments: {
    id: string
    program: { id: string; name: string; code: string }
    status: string
    startDate: Date | null
    endDate: Date | null
  }[]
  diagnoses: {
    id: string
    code: string
    description: string | null
    type: string
    isActive: boolean
  }[]
  contacts: {
    id: string
    firstName: string
    lastName: string
    relationship: string
    email: string | null
    phone: string | null
    isEmergency: boolean
    isGuardian: boolean
  }[]
  assignments: {
    id: string
    staff: { id: string; name: string | null; email: string }
    role: string
    isPrimary: boolean
  }[]
  packets: {
    id: string
    packetType: string
    status: string
    dueDate: Date | null
    createdAt: Date
  }[]
}
