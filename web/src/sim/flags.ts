/** Nationality -> flag emoji. Liquipedia/HLTV spell out country names, and the
 *  flag is the fastest way to read the chemistry bloc at a glance. */
const MAP: Record<string, string> = {
  Denmark: "🇩🇰", Sweden: "🇸🇪", Norway: "🇳🇴", Finland: "🇫🇮", Iceland: "🇮🇸",
  Poland: "🇵🇱", Ukraine: "🇺🇦", Russia: "🇷🇺", Belarus: "🇧🇾", Kazakhstan: "🇰🇿",
  France: "🇫🇷", Belgium: "🇧🇪", Netherlands: "🇳🇱", Germany: "🇩🇪", Austria: "🇦🇹",
  Switzerland: "🇨🇭", "United Kingdom": "🇬🇧", Ireland: "🇮🇪", Spain: "🇪🇸",
  Portugal: "🇵🇹", Italy: "🇮🇹", Romania: "🇷🇴", Bulgaria: "🇧🇬", Hungary: "🇭🇺",
  "Czech Republic": "🇨🇿", Slovakia: "🇸🇰", Slovenia: "🇸🇮", Croatia: "🇭🇷",
  Serbia: "🇷🇸", "Bosnia and Herzegovina": "🇧🇦", "North Macedonia": "🇲🇰",
  Kosovo: "🇽🇰", Albania: "🇦🇱", Greece: "🇬🇷", Türkiye: "🇹🇷", Turkey: "🇹🇷",
  Israel: "🇮🇱", Latvia: "🇱🇻", Lithuania: "🇱🇹", Estonia: "🇪🇪",
  "United States": "🇺🇸", Canada: "🇨🇦", Mexico: "🇲🇽", Brazil: "🇧🇷",
  Argentina: "🇦🇷", Chile: "🇨🇱", Uruguay: "🇺🇾", Guatemala: "🇬🇹",
  Australia: "🇦🇺", "New Zealand": "🇳🇿", China: "🇨🇳", Mongolia: "🇲🇳",
  Indonesia: "🇮🇩", Singapore: "🇸🇬", Malaysia: "🇲🇾", Thailand: "🇹🇭",
  "South Africa": "🇿🇦", Jordan: "🇯🇴", Georgia: "🇬🇪", Armenia: "🇦🇲", Moldova: "🇲🇩",
};
export const flag = (n: string) => MAP[n] ?? "🏳️";
