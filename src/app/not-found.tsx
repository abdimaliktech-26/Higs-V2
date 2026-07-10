import Link from "next/link"
import { Button } from "@/components/ui/button"
import { FileQuestion } from "lucide-react"

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface-50 p-8">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-100 mb-6">
        <FileQuestion className="h-8 w-8 text-surface-400" />
      </div>
      <h1 className="text-2xl font-bold text-surface-900 mb-2">Page not found</h1>
      <p className="text-surface-500 text-center max-w-md mb-6">
        The page you&apos;re looking for doesn&apos;t exist or has been moved.
      </p>
      <Link href="/dashboard">
        <Button>Go to Dashboard</Button>
      </Link>
    </div>
  )
}
