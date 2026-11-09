// Hash routes: #/ (library), #/match/<id>/<tab>[/<round>[/<seconds after freeze end>]], #/aggregate, #/clip, #/lineups,
// #/highlights[/<id>], #/callouts[/<map>], #/scout[/<team>[/<map>[/<tab>]]][?last=&side=&buy=&rounds=]

/** The /-separated parts of the hash route, decoded. */
export const hashParts = () =>
  window.location.hash.split("?")[0].replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);

/** The ?a=b part of the hash route. */
export const hashQuery = () => new URLSearchParams(window.location.hash.split("?")[1] ?? "");

export const go = (...parts: (string | number)[]) => {
  window.location.hash = "#/" + parts.map((p) => encodeURIComponent(String(p))).join("/");
};
