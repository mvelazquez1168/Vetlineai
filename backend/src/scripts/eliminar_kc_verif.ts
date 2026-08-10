import { eliminarUsuarioKeycloak } from "../keycloakAdmin";
eliminarUsuarioKeycloak("fefbbc61-dd6d-4e64-97af-f0f4862bec57").then(() => {
  console.log("OK");
  process.exit(0);
}).catch((err: unknown) => {
  console.error("ERROR", err);
  process.exit(1);
});
