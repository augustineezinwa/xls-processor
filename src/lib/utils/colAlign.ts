// Column alignment based on semantic type
export function colAlign(semanticType: string): string {
    switch (semanticType) {
        case "quantity":
        case "unit_price":
        case "amount":
        case "percentage":
            return "text-right";
        case "identifier":
            return "text-center";
        default:
            return "text-left";
    }
};