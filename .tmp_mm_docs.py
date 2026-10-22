import json, sys, urllib.parse, urllib.request

BASE = "https://platform.minimaxi.com/api/zh"


def get(path, **params):
    url = BASE + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def detail(keyword):
    return get("/documentDetail", keyword=keyword)


def list_docs(doc_id):
    return get("/document", id=doc_id)


if __name__ == "__main__":
    mode = sys.argv[1]
    if mode == "search":
        data = detail(sys.argv[2])
        for v in data.get("data", {}).values():
            print(v["documentId"], "|", v["documentTitle"], "|", v.get("LinkUrl"))
    elif mode == "tree":
        data = list_docs(sys.argv[2])
        print(json.dumps(data, ensure_ascii=False)[:4000])
    elif mode == "full":
        # dump every matched field of a keyword search to a file
        data = detail(sys.argv[2])
        out = []
        for v in data.get("data", {}).values():
            for ctype, blocks in (v.get("contentByType") or {}).items():
                for b in blocks:
                    for f in b.get("matchedFields", []):
                        out.append({"doc": v["documentId"], "title": v["documentTitle"],
                                    "url": v.get("LinkUrl"), "type": ctype,
                                    "field": f.get("field"), "value": f.get("value")})
        with open(sys.argv[3], "w", encoding="utf-8") as fh:
            json.dump(out, fh, ensure_ascii=False, indent=1)
        print("wrote", len(out))
