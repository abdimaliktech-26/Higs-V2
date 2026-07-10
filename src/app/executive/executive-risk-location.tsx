import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/states"
import { MapPin } from "lucide-react"

export function RiskByLocationCard() {
  return (
    <Card>
      <CardHeader><CardTitle>Risk by Location</CardTitle></CardHeader>
      <CardContent>
        <EmptyState
          className="py-10"
          icon={<MapPin className="h-6 w-6" />}
          title="Coming soon"
          description="Geographic risk scoring isn't tracked yet — there's no risk model tied to client location in the platform today."
        />
      </CardContent>
    </Card>
  )
}
