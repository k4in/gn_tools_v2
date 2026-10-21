import { type PlanEntry, type PlanTemplate } from "@/lib/gn-data/plan.ts";

export const fastRaumhafen: PlanTemplate = {
  id: "fast_raumhafen",
  label: "Fast Raumhafen",
  plan: [
    {
      id: "default_koloniezentrum",
      kind: "tech",
      name: "Koloniezentrum",
      startTick: 0,
    },
    {
      id: "tech_mrtlma93_b2f4hb",
      kind: "tech",
      name: "Bergbau",
      startTick: 2,
    },
    {
      id: "tech_mrtlmi4w_kb4efq",
      kind: "tech",
      name: "Metallmine",
      startTick: 6,
    },
    {
      id: "tech_mrtlml7b_d1ugmt",
      kind: "tech",
      name: "Kristallmine",
      startTick: 6,
    },
    {
      id: "tech_mrtln3kn_3dksty",
      kind: "tech",
      name: "Robotik",
      startTick: 8,
    },
    {
      id: "tech_mrtlndnr_o853u4",
      kind: "tech",
      name: "Zweite Metallmine",
      startTick: 8,
    },
    {
      id: "tech_mrtlnmof_kh0kot",
      kind: "tech",
      name: "Zweite Kristallmine",
      startTick: 8,
    },
    {
      id: "tech_mrtlotnr_iprwzu",
      kind: "tech",
      name: "Tiefe Metallminen",
      startTick: 16,
    },
    {
      id: "tech_mrtlp0hz_z98dbu",
      kind: "tech",
      name: "Tiefe Kristallminen",
      startTick: 16,
    },
    {
      id: "tech_mrupldiq_gzl32m",
      kind: "tech",
      name: "Fortgeschrittene Robotik",
      startTick: 24,
    },
    {
      id: "tech_mrupmso1_llr8pa",
      kind: "tech",
      name: "Raumfahrt",
      startTick: 25,
    },
    {
      id: "tech_mrupnkgx_nhtpwz",
      kind: "tech",
      name: "Planetare Werften",
      startTick: 38,
    },
    {
      id: "tech_mrupnplu_p8p690",
      kind: "tech",
      name: "Vollautomatisierte Metallmine",
      startTick: 40,
    },
    {
      id: "tech_mrupns6y_py5ux1",
      kind: "tech",
      name: "Vollautomatisierte Kristallmine",
      startTick: 40,
    },
    {
      id: "tech_mrupo4oy_nzizr3",
      kind: "tech",
      name: "Wiederverwendbare Trägersysteme",
      startTick: 62,
    },
    {
      id: "tech_mrupobex_cd2x36",
      kind: "tech",
      name: "Bergbaulaser",
      startTick: 62,
    },
    {
      id: "tech_mrupos8j_wwn9cq",
      kind: "tech",
      name: "Raumstation",
      startTick: 74,
    },
    {
      id: "tech_mrupoyih_zgpkew",
      kind: "tech",
      name: "Observatorium",
      startTick: 74,
    },
  ] satisfies PlanEntry[],
};
