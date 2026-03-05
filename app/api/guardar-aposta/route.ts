import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

const supabase = createClient(supabaseUrl, supabaseAnonKey)

export async function POST(req: Request) {
  try {
    const body = await req.json()

    const {
      data,
      game_id,
      jogo,
      mercado,
      selecao,
      odd_banca,
      prob_jarvis,
      odd_justa,
      ev,
      farol,
    } = body

    // validações mínimas
    if (!jogo || !mercado || !selecao) {
      return NextResponse.json(
        { error: "Campos obrigatórios ausentes (jogo/mercado/selecao)." },
        { status: 400 }
      )
    }

    const odd = Number(odd_banca)
    if (!Number.isFinite(odd) || odd <= 1) {
      return NextResponse.json(
        { error: "odd_banca inválida (use número > 1)." },
        { status: 400 }
      )
    }

    const { data: inserted, error } = await supabase
      .from("apostas")
      .insert([
        {
          data: data ?? undefined,
          game_id: game_id ?? undefined,
          jogo,
          mercado,
          selecao,
          odd_banca: odd,
          prob_jarvis: Number(prob_jarvis),
          odd_justa: Number(odd_justa),
          ev: Number(ev),
          farol,
        },
      ])
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, aposta: inserted })
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message ?? "Erro inesperado" },
      { status: 500 }
    )
  }
}