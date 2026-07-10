"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/actions/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select } from "@/components/ui/select"
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Alert } from "@/components/ui/alert"
import { ArrowLeft, Save, Loader2 } from "lucide-react"
import Link from "next/link"

const stateOptions = [
  { value: "MN", label: "Minnesota" },
  { value: "WI", label: "Wisconsin" },
  { value: "IA", label: "Iowa" },
  { value: "ND", label: "North Dakota" },
  { value: "SD", label: "South Dakota" },
]

const genderOptions = [
  { value: "Male", label: "Male" },
  { value: "Female", label: "Female" },
  { value: "Non-binary", label: "Non-binary" },
  { value: "Prefer not to say", label: "Prefer not to say" },
]

const statusOptions = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
  { value: "pending", label: "Pending" },
]

export function ClientForm() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const form = new FormData(e.currentTarget)
    const data = {
      firstName: form.get("firstName") as string,
      lastName: form.get("lastName") as string,
      dateOfBirth: form.get("dateOfBirth") as string,
      email: form.get("email") as string,
      phone: form.get("phone") as string,
      address: form.get("address") as string,
      city: form.get("city") as string,
      state: form.get("state") as string,
      zipCode: form.get("zipCode") as string,
      mcadId: form.get("mcadId") as string,
      gender: form.get("gender") as string,
      preferredLanguage: form.get("preferredLanguage") as string,
      fundingSource: form.get("fundingSource") as string,
      status: form.get("status") as string,
      notes: form.get("notes") as string,
    }

    const result = await createClient(data)
    if (result.success) {
      router.push(`/clients/${result.data.id}`)
      router.refresh()
    } else {
      setError(result.error)
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Card>
        <CardHeader>
          <CardTitle>Client Information</CardTitle>
          <CardDescription>Enter the client&apos;s demographic and contact information</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {error && (
            <Alert variant="error">
              <p>{error}</p>
            </Alert>
          )}

          {/* Name */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="First Name *" name="firstName" placeholder="First name" required />
            <Input label="Last Name *" name="lastName" placeholder="Last name" required />
          </div>

          <Separator />

          {/* Demographics */}
          <p className="text-sm font-medium text-surface-700">Demographics</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <Input label="Date of Birth" name="dateOfBirth" type="date" />
            <Select label="Gender" name="gender" options={genderOptions} placeholder="Select gender" />
            <Input label="Preferred Language" name="preferredLanguage" placeholder="e.g. English, Spanish" />
          </div>

          <Separator />

          {/* Contact */}
          <p className="text-sm font-medium text-surface-700">Contact Information</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Email" name="email" type="email" placeholder="client@example.com" />
            <Input label="Phone" name="phone" type="tel" placeholder="(555) 123-4567" />
          </div>
          <Input label="Street Address" name="address" placeholder="123 Main Street" />
          <div className="grid gap-4 sm:grid-cols-3">
            <Input label="City" name="city" placeholder="Minneapolis" />
            <Select label="State" name="state" options={stateOptions} placeholder="Select state" />
            <Input label="ZIP Code" name="zipCode" placeholder="55401" />
          </div>

          <Separator />

          {/* 245D / System */}
          <p className="text-sm font-medium text-surface-700">System Identifiers</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="MCAD ID" name="mcadId" placeholder="MN-245D-2024-XXXX" hint="Minnesota 245D identifier" />
            <Select label="Status" name="status" options={statusOptions} placeholder="Select status" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Funding Source" name="fundingSource" placeholder="e.g. Medical Assistance / Waiver" />
          </div>

          <Separator />

          {/* Notes */}
          <Textarea
            label="Notes"
            name="notes"
            placeholder="Additional notes about the client..."
            rows={4}
          />
        </CardContent>
        <CardFooter className="justify-between">
          <Link href="/clients">
            <Button type="button" variant="secondary">
              <ArrowLeft className="h-4 w-4" />
              Cancel
            </Button>
          </Link>
          <Button type="submit" loading={loading}>
            <Save className="h-4 w-4" />
            {loading ? "Creating..." : "Create Client"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  )
}
