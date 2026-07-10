"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { updateClient, getClientById } from "@/lib/actions/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select } from "@/components/ui/select"
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Alert } from "@/components/ui/alert"
import { LoadingState, ErrorState } from "@/components/ui/states"
import { ArrowLeft, Save } from "lucide-react"
import Link from "next/link"
import { formatDate } from "@/lib/utils"

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
  { value: "archived", label: "Archived" },
]

interface Props {
  clientId: string
}

export function EditClientForm({ clientId }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [defaults, setDefaults] = useState<Record<string, string>>({})

  useEffect(() => {
    async function load() {
      try {
        const client = await getClientById(clientId)
        if (!client) {
          setNotFound(true)
          return
        }
        setDefaults({
          firstName: client.firstName,
          lastName: client.lastName,
          dateOfBirth: client.dateOfBirth ? new Date(client.dateOfBirth).toISOString().split("T")[0] : "",
          email: client.email || "",
          phone: client.phone || "",
          address: client.address || "",
          city: client.city || "",
          state: client.state || "",
          zipCode: client.zipCode || "",
          mcadId: client.mcadId || "",
          gender: client.gender || "",
          preferredLanguage: client.preferredLanguage || "",
          fundingSource: client.fundingSource || "",
          status: client.status,
          notes: client.notes || "",
        })
      } catch {
        setError("Failed to load client data")
      } finally {
        setFetching(false)
      }
    }
    load()
  }, [clientId])

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

    const result = await updateClient(clientId, data)
    if (result.success) {
      router.push(`/clients/${clientId}`)
      router.refresh()
    } else {
      setError(result.error)
      setLoading(false)
    }
  }

  if (fetching) {
    return <LoadingState title="Loading client data..." />
  }

  if (notFound) {
    return <ErrorState title="Client not found" description="This client may have been removed." />
  }

  return (
    <form onSubmit={handleSubmit}>
      <Card>
        <CardHeader>
          <CardTitle>Client Information</CardTitle>
          <CardDescription>Update {defaults.firstName} {defaults.lastName}&apos;s information</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {error && (
            <Alert variant="error">
              <p>{error}</p>
            </Alert>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="First Name *" name="firstName" defaultValue={defaults.firstName} required />
            <Input label="Last Name *" name="lastName" defaultValue={defaults.lastName} required />
          </div>

          <Separator />

          <p className="text-sm font-medium text-surface-700">Demographics</p>
          <div className="grid gap-4 sm:grid-cols-3">
            <Input label="Date of Birth" name="dateOfBirth" type="date" defaultValue={defaults.dateOfBirth} />
            <Select label="Gender" name="gender" options={genderOptions} placeholder="Select gender" />
            <Input label="Preferred Language" name="preferredLanguage" defaultValue={defaults.preferredLanguage} />
          </div>

          <Separator />

          <p className="text-sm font-medium text-surface-700">Contact Information</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Email" name="email" type="email" defaultValue={defaults.email} />
            <Input label="Phone" name="phone" type="tel" defaultValue={defaults.phone} />
          </div>
          <Input label="Street Address" name="address" defaultValue={defaults.address} />
          <div className="grid gap-4 sm:grid-cols-3">
            <Input label="City" name="city" defaultValue={defaults.city} />
            <Select label="State" name="state" options={stateOptions} placeholder="Select state" />
            <Input label="ZIP Code" name="zipCode" defaultValue={defaults.zipCode} />
          </div>

          <Separator />

          <p className="text-sm font-medium text-surface-700">System Identifiers</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="MCAD ID" name="mcadId" defaultValue={defaults.mcadId} />
            <Input label="Funding Source" name="fundingSource" defaultValue={defaults.fundingSource} />
          </div>
          <Select label="Status" name="status" options={statusOptions} placeholder="Select status" />

          <Separator />

          <Textarea label="Notes" name="notes" defaultValue={defaults.notes} rows={4} />
        </CardContent>
        <CardFooter className="justify-between">
          <Link href={`/clients/${clientId}`}>
            <Button type="button" variant="secondary">
              <ArrowLeft className="h-4 w-4" />
              Cancel
            </Button>
          </Link>
          <Button type="submit" loading={loading}>
            <Save className="h-4 w-4" />
            {loading ? "Saving..." : "Save Changes"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  )
}
