import { describe, expect, it } from "vitest";

import { selectReferenceImageUrls } from "@/lib/ai/video/selectReferenceImageUrls";

describe("selectReferenceImageUrls", () => {
  it("利用者の署名付き写真URL以外を除外してSSRFを防ぐ", () => {
    const signedPhotoUrls = [
      "https://storage.example.com/1.jpg?token=one",
      "https://storage.example.com/2.jpg?token=two",
      "https://storage.example.com/3.jpg?token=three",
      "https://storage.example.com/4.jpg?token=four",
    ];

    expect(
      selectReferenceImageUrls(
        [
          "http://169.254.169.254/latest/meta-data/",
          signedPhotoUrls[0],
          "https://attacker.example/internal",
          signedPhotoUrls[1],
          signedPhotoUrls[2],
          signedPhotoUrls[3],
        ],
        signedPhotoUrls,
      ),
    ).toEqual(signedPhotoUrls.slice(0, 3));
  });
});
