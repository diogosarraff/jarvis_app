import { NextResponse } from "next/server"
import { supabase } from "@/lib/supabase"

export async function POST(request: Request) {
  const body = await request.json()

  const { game_id, pick, odd_banca, prob_jarvis, odd_justa, ev } = body

  const { error } = await supabase.from("apostas_pendentes").insert([
    {
      game_id,
      market: "ML",
      pick,
      odd_banca,
      prob_jarvis,
      odd_justa,
      ev,
    },
  ])

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}