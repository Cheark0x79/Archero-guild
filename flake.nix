{
  description = "Isolated Archero observer automation and OCR environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];

      forAllSystems = nixpkgs.lib.genAttrs systems;
    in
    {
      packages = forAllSystems (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
          python = pkgs.python312;
          pythonEnv = python.withPackages (
            ps: with ps; [
              pillow
              psycopg
              pytesseract
            ]
          );
          serveWeb = pkgs.writeShellApplication {
            name = "archero-dashboard";
            runtimeInputs = [
              pkgs.nodejs_22
            ];
            text = ''
              cd "$PWD"
              port="''${ARCHERO_DASHBOARD_PORT:-5181}"
              exec npm --prefix web run dev -- -H 127.0.0.1 -p "$port"
            '';
          };
        in
        {
          default = python.pkgs.buildPythonApplication {
            pname = "archero-observer";
            version = "0.1.0";
            src = self;
            format = "other";

            nativeBuildInputs = [
              pkgs.makeWrapper
            ];

            dontBuild = true;

            installPhase = ''
              runHook preInstall

              mkdir -p "$out/lib/archero-observer" "$out/bin"
              cp -r observer "$out/lib/archero-observer/"
              makeWrapper ${pythonEnv}/bin/python "$out/bin/archero-observer" \
                --set PYTHONPATH "$out/lib/archero-observer" \
                --add-flags "-m observer.run"
              makeWrapper ${pythonEnv}/bin/python "$out/bin/archero-capture" \
                --set PYTHONPATH "$out/lib/archero-observer" \
                --add-flags "-m observer.capture"
              makeWrapper ${pythonEnv}/bin/python "$out/bin/archero-import" \
                --set PYTHONPATH "$out/lib/archero-observer" \
                --prefix PATH : ${pkgs.tesseract}/bin \
                --add-flags "-m observer.import_capture"
              makeWrapper ${pythonEnv}/bin/python "$out/bin/archero-day" \
                --set PYTHONPATH "$out/lib/archero-observer" \
                --prefix PATH : ${pkgs.tesseract}/bin \
                --add-flags "-m observer.day"

              runHook postInstall
            '';

            checkPhase = ''
              runHook preCheck
              PYTHONPATH="$PWD" ${python}/bin/python -B -m unittest discover -s tests
              runHook postCheck
            '';

            meta.mainProgram = "archero-observer";
          };

          dashboard = serveWeb;
        }
      );

      devShells = forAllSystems (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
          python = pkgs.python312;
          pythonEnv = python.withPackages (
            ps: with ps; [
              pillow
              psycopg
              pytesseract
              pytest
            ]
          );
        in
        {
          default = pkgs.mkShell {
            packages = [
              pkgs.android-tools
              pkgs.jq
              pkgs.nodejs_22
              pkgs.postgresql_16
              pkgs.tesseract
              self.packages.${system}.default
              self.packages.${system}.dashboard
              pythonEnv
            ];

            shellHook = ''
              export PATH="${pythonEnv}/bin:$PATH"
              export PYTHONPATH="$PWD''${PYTHONPATH:+:$PYTHONPATH}"
              export TESSDATA_PREFIX="${pkgs.tesseract}/share/tessdata"
              echo "Archero observer dev shell"
              echo "Tests: python -B -m unittest discover -s tests"
              echo "Dry run: python -B -m observer.run --config config/observer.example.json"
              echo "Capture: archero-capture guild-members"
              echo "Import latest: archero-import"
              echo "Import today screenshots: archero-day"
              echo "Dashboard: archero-dashboard"
              echo "Next.js direct: npm --prefix web run dev"
            '';
          };
        }
      );

      checks = forAllSystems (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
          python = pkgs.python312;
          pythonEnv = python.withPackages (
            ps: with ps; [
              pillow
              psycopg
              pytesseract
            ]
          );
        in
        {
          unit-tests = pkgs.stdenvNoCC.mkDerivation {
            name = "archero-observer-unit-tests";
            src = self;
            nativeBuildInputs = [
              pythonEnv
              pkgs.nodejs_22
            ];
            dontBuild = true;
            checkPhase = ''
              PYTHONPATH="$PWD" python -B -m unittest discover -s tests
              python -B -m observer.run --config config/observer.example.json
              node --test web/tests/*.test.mjs
            '';
            installPhase = ''
              mkdir -p "$out"
              touch "$out/success"
            '';
          };
        }
      );
    };
}
