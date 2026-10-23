"""Build video/src/data/india_night.json: India outline + city positions in one shared projection,
for the 3D "night map of payments" in the cold open.

Source: datameet/maps Country/india-composite.geojson (official boundaries, CC BY 2.5 IN)
        https://github.com/datameet/maps
usage: python3 tools/make_night_map.py path/to/india-composite.geojson
"""
import json
import math
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
W = 1000.0
LAT_REF = math.radians(22.0)  # equirectangular, x scaled by cos(22°): good enough for India's span

# (name, lat, lon, weight ~ metro size)
CITIES = [
    ("Delhi", 28.61, 77.21, 10), ("Mumbai", 19.08, 72.88, 10), ("Kolkata", 22.57, 88.36, 8), ("Chennai", 13.08, 80.27, 8),
    ("Bengaluru", 12.97, 77.59, 9), ("Hyderabad", 17.39, 78.49, 8), ("Ahmedabad", 23.02, 72.57, 6), ("Pune", 18.52, 73.86, 6),
    ("Jaipur", 26.91, 75.79, 5), ("Lucknow", 26.85, 80.95, 5), ("Kanpur", 26.45, 80.33, 4), ("Nagpur", 21.15, 79.09, 4),
    ("Indore", 22.72, 75.86, 4), ("Bhopal", 23.26, 77.41, 4), ("Patna", 25.59, 85.14, 4), ("Surat", 21.17, 72.83, 5),
    ("Vadodara", 22.31, 73.18, 3), ("Ludhiana", 30.90, 75.86, 3), ("Agra", 27.18, 78.01, 3), ("Varanasi", 25.32, 82.97, 3),
    ("Guwahati", 26.14, 91.74, 3), ("Bhubaneswar", 20.30, 85.82, 3), ("Ranchi", 23.34, 85.31, 3), ("Raipur", 21.25, 81.63, 3),
    ("Kochi", 9.93, 76.27, 3), ("Thiruvananthapuram", 8.52, 76.94, 3), ("Coimbatore", 11.02, 76.96, 3), ("Madurai", 9.93, 78.12, 3),
    ("Visakhapatnam", 17.69, 83.22, 3), ("Vijayawada", 16.51, 80.65, 3), ("Chandigarh", 30.73, 76.78, 3), ("Dehradun", 30.32, 78.03, 2),
    ("Srinagar", 34.08, 74.80, 2), ("Jammu", 32.73, 74.86, 2), ("Amritsar", 31.63, 74.87, 2), ("Shimla", 31.10, 77.17, 1),
    ("Panaji", 15.49, 73.83, 1), ("Mangaluru", 12.91, 74.86, 2), ("Mysuru", 12.30, 76.64, 2), ("Imphal", 24.82, 93.94, 1),
    ("Shillong", 25.58, 91.89, 1), ("Jodhpur", 26.24, 73.02, 2), ("Udaipur", 24.59, 73.71, 2), ("Rajkot", 22.30, 70.80, 2),
    ("Nashik", 20.00, 73.79, 2), ("Aurangabad", 19.88, 75.34, 2), ("Gwalior", 26.22, 78.18, 2), ("Jabalpur", 23.18, 79.99, 2),
    ("Prayagraj", 25.44, 81.85, 2), ("Gorakhpur", 26.76, 83.37, 2), ("Siliguri", 26.73, 88.40, 1), ("Agartala", 23.83, 91.28, 1),
    ("Puducherry", 11.94, 79.81, 1), ("Tiruchirappalli", 10.79, 78.70, 2), ("Hubballi", 15.36, 75.12, 1), ("Kozhikode", 11.26, 75.78, 2),
    ("Warangal", 17.97, 79.59, 1), ("Bikaner", 28.02, 73.31, 1), ("Leh", 34.15, 77.58, 1), ("Port Blair", 11.62, 92.73, 1),
]


def rings(geom):
    if geom["type"] == "Polygon":
        return [geom["coordinates"][0]]
    return [poly[0] for poly in geom["coordinates"]]


def dp(pts, eps):
    """Douglas–Peucker on an open polyline."""
    if len(pts) < 3:
        return pts
    (x0, y0), (x1, y1) = pts[0], pts[-1]
    dx, dy = x1 - x0, y1 - y0
    L = math.hypot(dx, dy) or 1e-9
    idx, dmax = 0, 0.0
    for i in range(1, len(pts) - 1):
        d = abs(dy * pts[i][0] - dx * pts[i][1] + x1 * y0 - y1 * x0) / L
        if d > dmax:
            idx, dmax = i, d
    if dmax <= eps:
        return [pts[0], pts[-1]]
    return dp(pts[: idx + 1], eps)[:-1] + dp(pts[idx:], eps)


def area(r):
    return abs(sum(r[i][0] * r[i - 1][1] - r[i - 1][0] * r[i][1] for i in range(len(r)))) / 2


def main():
    g = json.loads(pathlib.Path(sys.argv[1]).read_text())
    all_rings = [r for f in g["features"] for r in rings(f["geometry"])]
    lons = [p[0] for r in all_rings for p in r]
    lats = [p[1] for r in all_rings for p in r]
    lon0, lon1, lat0, lat1 = min(lons), max(lons), min(lats), max(lats)
    k = W / ((lon1 - lon0) * math.cos(LAT_REF))
    H = round((lat1 - lat0) * k, 1)

    def proj(lon, lat):
        return ((lon - lon0) * math.cos(LAT_REF) * k, (lat1 - lat) * k)

    paths = []
    for r in sorted(all_rings, key=area, reverse=True):
        if area(r) < 0.02:  # drop specks (keeps the island groups' larger islands)
            continue
        pts = [proj(*p) for p in r]
        half = len(pts) // 2  # split the closed ring so DP has two open halves
        simp = dp(pts[: half + 1], 0.9)[:-1] + dp(pts[half:], 0.9)
        if len(simp) < 4:
            continue
        paths.append("M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in simp) + " Z")
    cities = [{"name": n, "x": round(proj(lon, lat)[0], 1), "y": round(proj(lon, lat)[1], 1), "w": w} for n, lat, lon, w in CITIES]
    out = {"viewBox": [0, 0, W, H], "path": " ".join(paths), "cities": cities,
           "source": "datameet/maps Country/india-composite.geojson (CC BY 2.5 IN), simplified; city coordinates approximate"}
    dst = ROOT / "video" / "src" / "data" / "india_night.json"
    dst.write_text(json.dumps(out, ensure_ascii=False))
    print(dst, "viewBox", out["viewBox"], "rings", len(paths), "chars", len(out["path"]))


if __name__ == "__main__":
    main()
