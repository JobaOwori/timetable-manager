import { Badge } from "@/components/ui/badge";
import { FacultyType } from "@/lib/types";
import { FACULTY_TYPE_LABEL } from "@/lib/facultyType";

/** Visible Full-Time / Part-Time tag used across the app. */
export function FacultyTypeBadge({ type }: { type: FacultyType }) {
  return (
    <Badge tone={type === "FT" ? "brass" : "info"}>
      {type === "FT" ? "Full-Time" : "Part-Time"}
    </Badge>
  );
}

export { FACULTY_TYPE_LABEL };
