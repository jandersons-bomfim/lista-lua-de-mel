-- USE SOMENTE se você já executou uma versão ANTERIOR de 0001_init.sql (com a lista antiga de cotas).
-- Substitui as cotas pela lista atual. Contribuições já registradas não são afetadas (guardam cópia do título e valor).
delete from public.gifts;
insert into public.gifts (title, description, price_cents, image_url, image_alt, sort_order) values
 ('Nosso primeiro café no Rio', 'Uma manhã tranquila à beira-mar, com café quente e nenhuma pressa.', 20000, 'img/cafe.svg', 'Xícara de café fumegante diante do mar', 10),
 ('Nosso encontro com o Cristo', 'Um dos cartões-postais mais bonitos do Rio, visto de pertinho.', 30000, 'img/cristo.svg', 'Ilustração do Cristo Redentor sobre o Corcovado', 20),
 ('Nosso passeio entre jardins', 'Um passeio sem pressa entre árvores e cantinhos do Parque Lage.', 20000, 'img/jardins.svg', 'Ilustração do palacete do Parque Lage entre palmeiras', 30),
 ('Uma vista para guardar na memória', 'Um mirante, o mar lá embaixo e uma lembrança que fica para sempre.', 40000, 'img/vista.svg', 'Ilustração do Pão de Açúcar sobre a baía', 40),
 ('Uma experiência nas alturas', 'Um momento lá no alto, para ver o Rio de um jeito diferente.', 50000, 'img/alturas.svg', 'Ilustração de uma asa-delta sobre a costa do Rio', 50),
 ('Uma noite da nossa lua de mel', 'Um descanso a dois, depois de dias cheios de passeios.', 60000, 'img/noite.svg', 'Ilustração noturna do Rio com lua crescente', 60),
 ('Um álbum de momentos felizes', 'Para revelar fotos, guardar lembranças e reviver cada instante da viagem.', 30000, 'img/album.svg', 'Ilustração de fotos coladas em um álbum', 70),
 ('Um jantar de celebração', 'Uma noite à mesa, só nós dois, para brindar o começo dessa história.', 50000, 'img/jantar.svg', 'Ilustração de duas taças brindando', 80),
 ('Nossa noite de sabores cariocas', 'Petiscos, bebidas e uma noite para provar o Rio com calma.', 20000, 'img/sabores.svg', 'Ilustração de uma caipirinha e petiscos', 90),
 ('Uma surpresa especial para os recém-casados', 'Uma lembrança escolhida com carinho para surpreender os dois.', 100000, 'img/surpresa.svg', 'Ilustração de um presente com laço dourado', 100),
 ('Conexão Salvador x Rio de Janeiro', 'Ajuda a levar a gente de Salvador até o Rio e a começar a viagem.', 140000, 'img/conexao.svg', 'Ilustração de um avião ligando Salvador ao Rio', 110);
