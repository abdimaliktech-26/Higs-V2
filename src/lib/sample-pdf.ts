export function generateMinimalPDF(title: string, pageCount: number = 1): Buffer {
  const escape = (s: string) => s.replace(/[\\()]/g, "\\$&")

  const objects: string[] = []
  let objNum = 1

  // Catalog
  objects.push(`${objNum} 0 obj\n<< /Type /Catalog /Pages ${objNum + 1} 0 R >>\nendobj`)
  objNum++

  // Pages
  const pageRefs: string[] = []
  for (let i = 0; i < pageCount; i++) {
    pageRefs.push(`${objNum + 1 + i * 2} 0 R`)
  }

  objects.push(`${objNum} 0 obj\n<< /Type /Pages /Kids [${pageRefs.join(" ")}] /Count ${pageCount} >>\nendobj`)
  objNum++

  for (let i = 0; i < pageCount; i++) {
    const contentObj = objNum + 1
    const fontSize = 11
    const leftMargin = 50
    const topMargin = 770

    const lines = [
      `BT /F1 ${fontSize} Tf ${leftMargin} ${topMargin - i * 10} Tm (${escape(title)}) Tj ET`,
      `BT /F1 8 Tf ${leftMargin} ${topMargin - 20 - i * 10} Tm (Page ${i + 1} of ${pageCount}) Tj ET`,
      `BT /F1 9 Tf ${leftMargin} ${topMargin - 40 - i * 10} Tm (Client: ___________________________________) Tj ET`,
      `BT /F1 9 Tf ${leftMargin} ${topMargin - 58 - i * 10} Tm (Date: ${new Date().toLocaleDateString()}) Tj ET`,
      `BT /F1 9 Tf ${leftMargin} ${topMargin - 76 - i * 10} Tm (MCAD ID: ________________________________) Tj ET`,
    ]

    objects.push(`${objNum} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentObj} 0 R /Resources << /Font << /F1 ${objNum + 2} 0 R >> >> >>\nendobj`)
    objNum++

    objects.push(`${objNum} 0 obj\n<< /Length ${lines.join("\n").length + 1} >>\nstream\n${lines.join("\n")}\nendstream\nendobj`)
    objNum++

    // Font
    objects.push(`${objNum} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj`)
    objNum++
  }

  const body = objects.join("\n")
  const xrefOffset = body.length + 120 // approximate
  const xrefEntries = objects.length + 1

  let xref = "xref\n"
  xref += `0 ${xrefEntries}\n`
  xref += "0000000000 65535 f \n"

  let offset = 0
  for (let i = 0; i < objects.length; i++) {
    // approximate offset — use start of each object
    xref += `${String(offset).padStart(10, "0")} 00000 n \n`
    offset += objects[i].length + 1
  }

  const trailer = `trailer\n<< /Size ${xrefEntries} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`

  const pdf = `%PDF-1.4\n${body}\n${xref}${trailer}`
  return Buffer.from(pdf, "latin1")
}
