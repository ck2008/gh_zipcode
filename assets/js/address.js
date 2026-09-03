window.PostalAddress = (() => {
  const cityAliases = {
    "台北市": "臺北市", "北市": "臺北市", "台中市": "臺中市", "中市": "臺中市",
    "台南市": "臺南市", "南市": "臺南市", "台東縣": "臺東縣", "台東": "臺東縣"
  };
  const cnToTw = window.OpenCC?.Converter?.({ from: "cn", to: "tw" }) ?? (value => value);
  const intValue = (value) => value === undefined ? -1 : Number(value);
  const chineseNumber = (value) => ({ "零": 0, "一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9, "壹": 1, "貳": 2, "參": 3, "肆": 4, "伍": 5, "陸": 6, "柒": 7, "捌": 8, "玖": 9 })[value] ?? Number(value);
  function normalize(value) {
    return cnToTw(String(value ?? "")).normalize("NFKC").replace(/[　\s]+/g, "").replace(/臺/g, "台");
  }
  function parse(raw) {
    const input = normalize(raw).replace(/^\d{3,6}(?=[^\d])/, "");
    const cityMatch = input.match(/^(.*?[縣市])/);
    let city = cityMatch?.[1] ?? "";
    let rest = city ? input.slice(city.length) : input;
    city = cityAliases[city] ?? city.replace(/台/g, "臺");
    const districtMatch = rest.match(/^(.*?(?:鄉|鎮|市|區))/);
    const district = districtMatch?.[1] ?? "";
    rest = district ? rest.slice(district.length) : rest;
    const villageMatch = rest.match(/^[^路街道]*?[村里裡]/);
    const streetFallback = villageMatch ? rest.slice(villageMatch[0].length).match(/^(.*?(?:大道|路|街|道))/)?.[1] ?? "" : "";
    rest = rest.replace(/^\d+鄰/, "");
    const streetMatch = rest.match(/^(.*?(?:大道|路|街|道))/);
    const street = streetMatch?.[1] ?? "";
    rest = street ? rest.slice(street.length) : rest;
    const sectorMatch = rest.match(/^([0-9０-９零一二三四五六七八九壹貳參肆伍陸柒捌玖]+)段/);
    const sector = sectorMatch ? String(chineseNumber(sectorMatch[1])) : "";
    rest = sectorMatch ? rest.slice(sectorMatch[0].length) : rest;
    const neighborhood = intValue(rest.match(/(\d+)鄰/)?.[1]);
    const lane = rest.match(/([^弄號樓]+)巷/)?.[1] ?? "-1";
    const alley = intValue(rest.match(/(\d+)弄/)?.[1]);
    const house = intValue(rest.match(/(\d+)號/)?.[1] ?? rest.match(/(\d+)之/)?.[1]);
    const houseSub = intValue(rest.match(/之(\d+)/)?.[1]);
    const floor = intValue(rest.match(/(\d+)樓/)?.[1]);
    return { input, city, district, street, streetFallback, sector, neighborhood, lane, alley, house, houseSub, floor, numberType: house === -1 ? 0 : house % 2 === 0 ? 2 : 1 };
  }
  function attempts(parsed) {
    const baseline = { ...parsed, recordType: 0 };
    const candidates = [
      baseline,
      { ...baseline, floor: -1 },
      { ...baseline, floor: -1, house: -1, numberType: parsed.alley === -1 ? 0 : parsed.alley % 2 === 0 ? 2 : 1, recordType: 3 },
      { ...baseline, floor: -1, house: -1, alley: -1, numberType: !/^\d+$/.test(parsed.lane) ? 0 : Number(parsed.lane) % 2 === 0 ? 2 : 1, recordType: 2 },
      { ...baseline, floor: -1, house: -1, alley: -1, lane: "-1", numberType: 2, recordType: 1 },
      { ...baseline, floor: -1, house: -1, alley: -1, lane: "-1", neighborhood: -1, numberType: 2, recordType: 1 }
    ];
    return parsed.streetFallback && parsed.streetFallback !== parsed.street ? [...candidates, ...candidates.map((candidate) => ({ ...candidate, street: parsed.streetFallback }))] : candidates;
  }
  return { normalize, parse, attempts };
})();
