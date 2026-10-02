// Texto del aviso de privacidad exigido por el art. 6 de la Ley 25.326
// (Protección de los Datos Personales, Argentina), más el consentimiento
// separado para la transferencia internacional de datos que activan los
// arts. 11 y 12 de la misma ley (Disposición 60-E/2016).
//
// ⚠️ BORRADOR: este texto fue redactado como parte de un trabajo final de
// tesis, a título de propuesta de diseño. NO reemplaza el asesoramiento de
// un/a abogado/a especializado/a en protección de datos personales y NO debe
// usarse para operar con datos reales de clientes sin esa revisión legal
// previa. Ver docs/cumplimiento-ley-25326.md para el detalle de lo que falta
// completar (inscripción de la base ante la AAIP, política de retención,
// cláusulas contractuales tipo con cada encargado del tratamiento).
//
// El componente se usa en dos lugares:
//   - /privacidad (página completa, enlazada desde el checkbox del formulario)
//   - potencialmente en cualquier otro punto de captación de datos que se
//     agregue a futuro (por ahora sólo existe el formulario de leads).
//
// Los placeholders entre corchetes ([...]) son datos reales que la persona u
// organización responsable del tratamiento debe completar antes de publicar
// el sitio con datos de clientes verdaderos.

export default function AvisoPrivacidad() {
  return (
    <div className="text-ink-soft space-y-6 text-[14.5px] leading-relaxed">
      <p className="text-brick border-brick/30 bg-brick/5 border px-4 py-3 text-[13px] leading-relaxed">
        <strong>Borrador sujeto a revisión legal.</strong> Este aviso de privacidad fue redactado
        como parte de un trabajo académico (trabajo final de tesis) y no ha sido revisado por un
        profesional del derecho. No debe utilizarse para procesar datos personales reales sin esa
        revisión previa. Ver{" "}
        <code className="bg-rule-soft rounded px-1 py-0.5 text-[12.5px]">
          docs/cumplimiento-ley-25326.md
        </code>{" "}
        en el repositorio del proyecto.
      </p>

      <section>
        <h2 className="text-ink font-serif text-[20px]">
          1. Identidad del responsable del tratamiento
        </h2>
        <p>
          El responsable del tratamiento de los datos personales recolectados a través de este
          formulario es <strong>[RAZÓN SOCIAL / NOMBRE DEL RESPONSABLE]</strong>, con domicilio en{" "}
          <strong>[DOMICILIO LEGAL]</strong> y CUIT/CUIL <strong>[CUIT/CUIL]</strong> (en adelante,
          &ldquo;el responsable&rdquo;).
        </p>
      </section>

      <section>
        <h2 className="text-ink font-serif text-[20px]">2. Finalidad del tratamiento</h2>
        <p>
          Los datos personales que usted proporciona a través de este formulario se recaban con el
          fin de:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            Evaluar y responder su consulta o solicitud de presupuesto para servicios profesionales.
          </li>
          <li>
            Contactarlo/a por correo electrónico, teléfono o mensajería para dar seguimiento a esa
            consulta.
          </li>
          <li>
            Elaborar y enviarle una propuesta comercial, y —en caso de aceptarla— gestionar la
            relación contractual, la facturación y el cobro del servicio.
          </li>
          <li>
            Llevar un registro administrativo interno de la gestión comercial (tablero de
            seguimiento).
          </li>
        </ul>
        <p className="mt-2">
          <strong>Opcional — bolsa de proyectos.</strong> Sólo si usted marca la casilla «Si no
          pueden tomar mi proyecto, compártanlo con otros desarrolladores» y el desarrollador al que
          escribió no puede tomarlo, se publica un resumen del proyecto (servicio, rango de
          presupuesto, urgencia y una descripción sin sus datos de contacto) para que otros
          desarrolladores registrados en la plataforma se postulen. Sus datos de contacto se
          comparten únicamente con el desarrollador que usted elija, y recién cuando lo elija. Si no
          marca la casilla, su consulta no se comparte con nadie más.
        </p>
        <p className="mt-2">
          <strong>Proyectos publicados por usted.</strong> Si publica un proyecto desde «Publicá tu
          proyecto», el título, la descripción, el tipo de trabajo, el rango de presupuesto y la
          urgencia los ven los desarrolladores registrados en la plataforma. Su nombre, correo y
          teléfono no se publican: se comparten únicamente con el desarrollador que usted elija, y
          recién cuando lo elija.
        </p>
        <p className="mt-2">
          Los datos no serán utilizados para fines distintos de los aquí enunciados, ni cedidos a
          terceros no mencionados en este aviso, salvo obligación legal o requerimiento de autoridad
          competente.
        </p>
      </section>

      <section>
        <h2 className="text-ink font-serif text-[20px]">
          3. Carácter obligatorio o facultativo de los datos
        </h2>
        <p>De los datos solicitados en el formulario:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>
              Nombre, correo electrónico, servicio de interés y descripción del proyecto
            </strong>{" "}
            son de carácter <strong>obligatorio</strong>: sin ellos no es posible evaluar ni
            responder su consulta, y el formulario no permite el envío si faltan.
          </li>
          <li>
            <strong>Teléfono</strong> es de carácter <strong>facultativo</strong>: su omisión no
            impide el envío del formulario, aunque puede demorar el contacto si el correo
            electrónico no está disponible.
          </li>
          <li>
            <strong>Presupuesto estimado y nivel de urgencia</strong> son de carácter{" "}
            <strong>facultativo</strong> y sirven únicamente para priorizar y ajustar la propuesta a
            enviar.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="text-ink font-serif text-[20px]">4. Destinatarios de los datos</h2>
        <p>
          Para cumplir las finalidades descriptas, sus datos son tratados y/o almacenados por los
          siguientes encargados del tratamiento, contratados por el responsable:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Supabase</strong> (Supabase Inc.) — aloja la base de datos donde se registra y
            persiste su consulta y el estado de la gestión comercial.
          </li>
          <li>
            <strong>Google LLC (Gmail)</strong> — se utiliza para el envío de correos electrónicos
            de contacto, propuestas y comprobantes.
          </li>
          <li>
            <strong>Telegram FZ-LLC (Telegram)</strong> — se utiliza para notificar internamente al
            equipo del responsable sobre la llegada de su consulta y su avance; no se le envían
            mensajes directos a través de este canal.
          </li>
        </ul>
        <p className="mt-2">
          Ninguno de estos destinatarios está autorizado a utilizar sus datos para fines propios ni
          distintos de los aquí informados.
        </p>
      </section>

      <section>
        <h2 className="text-ink font-serif text-[20px]">
          5. Derechos de acceso, rectificación y supresión (derechos ARCO)
        </h2>
        <p>
          De acuerdo con los arts. 14 a 16 de la Ley 25.326, usted tiene derecho a solicitar en
          cualquier momento, en forma gratuita:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <strong>Acceso</strong> a sus datos personales que obren en nuestras bases.
          </li>
          <li>
            <strong>Rectificación</strong> o actualización de datos inexactos o desactualizados.
          </li>
          <li>
            <strong>Supresión</strong> de sus datos cuando corresponda (por ejemplo, si fueron
            tratados en infracción a la ley o ya no son necesarios para la finalidad que motivó su
            recolección).
          </li>
          <li>
            <strong>Oposición</strong> o revocación del consentimiento previamente otorgado.
          </li>
        </ul>
        <p className="mt-2">
          Para ejercer estos derechos, puede escribir a{" "}
          <strong>[EMAIL DE CONTACTO PARA EJERCER DERECHOS ARCO]</strong>, indicando su nombre
          completo y el dato o solicitud concreta. El responsable dará respuesta dentro de los
          plazos que establece la Ley 25.326 y su reglamentación.
        </p>
        <p className="mt-2">
          Asimismo, se le informa que la <strong>AGENCIA DE ACCESO A LA INFORMACIÓN PÚBLICA</strong>
          , en su carácter de Órgano de Control de la Ley 25.326, tiene la atribución de atender las
          denuncias y reclamos que se interpongan con relación al incumplimiento de las normas sobre
          protección de datos personales (www.argentina.gob.ar/aaip).
        </p>
      </section>

      <section>
        <h2 className="text-ink font-serif text-[20px]">6. Medidas de seguridad</h2>
        <p>
          El responsable adopta medidas técnicas y organizativas razonables, conforme al art. 9 de
          la Ley 25.326, para proteger sus datos personales contra pérdida, alteración, acceso no
          autorizado o tratamiento indebido. No obstante, ningún sistema de transmisión o
          almacenamiento electrónico es completamente inviolable.
        </p>
      </section>

      <section>
        <h2 className="text-ink font-serif text-[20px]">7. Plazo de conservación</h2>
        <p>
          Sus datos se conservarán mientras sean necesarios para cumplir la finalidad informada en
          el punto 2 y, luego, durante el plazo que exijan las obligaciones legales aplicables (por
          ejemplo, fiscales o contables), tras lo cual serán suprimidos o anonimizados.{" "}
          <strong>
            [PENDIENTE: el responsable debe definir una política de retención concreta —plazos
            exactos por tipo de dato— antes de operar con datos reales; ver
            docs/cumplimiento-ley-25326.md]
          </strong>
          .
        </p>
      </section>

      <section className="border-ochre/40 bg-ochre/5 border-l-2 py-4 pl-5">
        <h2 className="text-ink font-serif text-[20px]">
          8. Consentimiento expreso para la transferencia internacional de datos (arts. 11 y 12, Ley
          25.326)
        </h2>
        <p className="mt-2">
          Algunos de los encargados del tratamiento detallados en el punto 4 —en particular,{" "}
          <strong>Supabase, Google LLC (Gmail) y Telegram FZ-LLC</strong>— están domiciliados o
          procesan datos en países que la Disposición 60-E/2016 de la (entonces) Dirección Nacional
          de Protección de Datos Personales <strong>no reconoce</strong> como países que ofrecen
          niveles de protección de datos personales adecuados en los términos del art. 12 de la Ley
          25.326 (por ejemplo, Estados Unidos).
        </p>
        <p className="mt-2">
          Esto implica que, al enviar este formulario, sus datos personales pueden ser transferidos
          internacionalmente hacia esos países. Conforme a los arts. 11 y 12 de la Ley 25.326, esa
          transferencia requiere su <strong>consentimiento previo, expreso e informado</strong>,
          adicional al consentimiento general para el tratamiento de sus datos.
        </p>
        <p className="mt-2">
          Al marcar el casillero de aceptación del formulario, usted{" "}
          <strong>presta ese consentimiento expreso</strong> para que sus datos de contacto (nombre,
          correo electrónico, teléfono, presupuesto estimado y descripción del proyecto) sean
          transferidos y almacenados en la infraestructura de Supabase, Google LLC (Gmail) y
          Telegram FZ-LLC, exclusivamente para las finalidades descriptas en el punto 2 de este
          aviso. Usted puede revocar este consentimiento en cualquier momento ejerciendo sus
          derechos ARCO según el punto 5, sin perjuicio de que la revocación no afecta la licitud
          del tratamiento realizado con anterioridad.
        </p>
        <p className="mt-2 text-[13px] italic">
          [PENDIENTE, alternativa al consentimiento expreso: suscribir cláusulas contractuales tipo
          —modelo aprobado por la Disposición 60-E/2016— con cada uno de estos encargados. Ver
          docs/cumplimiento-ley-25326.md.]
        </p>
      </section>

      <section>
        <h2 className="text-ink font-serif text-[20px]">9. Aceptación</h2>
        <p>
          El envío del formulario, con el casillero de consentimiento marcado, implica que usted ha
          leído, comprendido y aceptado el presente Aviso de Privacidad en su totalidad, incluido el
          consentimiento para la transferencia internacional de datos del punto 8.
        </p>
      </section>

      <p className="text-mist text-[12px]">
        Última actualización de este borrador: ver control de versiones del repositorio
        (FormularioLeads/src/app/components/AvisoPrivacidad.tsx). Documento de referencia:
        docs/cumplimiento-ley-25326.md.
      </p>
    </div>
  );
}
